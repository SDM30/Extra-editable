"""
Playwright worker reutilizable para tests de carga UI.

Cada instancia ejecuta un ciclo completo: login → abrir editor → escribir →
autocompletado LSP → verificar ejecución → logout. Registra métricas por paso
y capturas de pantalla en fallos.
"""

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict

from playwright.async_api import async_playwright, Page


# ── Código de prueba por lenguaje ──────────────────────────────────────────
# (código, texto_verificación, prefijo_lsp)

LANGUAGE_TEST: dict[str, tuple[str, str, str]] = {
    "python": (
        'print("hola mundo desde playwright")',
        "hola mundo",
        "prin",
    ),
    "typescript": (
        'const msg: string = "hola playwright";\nconsole.log(msg);',
        "hola playwright",
        "cons",
    ),
    "cpp": (
        '#include <iostream>\n\nint main() {\n  std::cout << "hola cpp desde playwright" << std::endl;\n  return 0;\n}',
        "hola cpp",
        "std::",
    ),
}


class UIStats:
    """Acumulador de métricas por paso del ciclo UI."""

    STEPS = ["login", "editor_load", "write_code", "lsp_completion", "execution", "logout"]

    def __init__(self):
        self.by_step: Dict[str, dict] = {
            step: {"success": 0, "error": 0, "latency_ms": []} for step in self.STEPS
        }
        self.total_cycles = 0
        self.successful_cycles = 0
        self.screenshots: list[str] = []

    def record(self, step: str, ok: bool, latency_ms: float, screenshot: str = ""):
        entry = self.by_step[step]
        if ok:
            entry["success"] += 1
        else:
            entry["error"] += 1
            if screenshot:
                self.screenshots.append(screenshot)
        entry["latency_ms"].append(latency_ms)

    def finish_cycle(self, all_ok: bool):
        self.total_cycles += 1
        if all_ok:
            self.successful_cycles += 1

    def snapshot(self) -> dict:
        steps = {}
        for name, data in self.by_step.items():
            total = data["success"] + data["error"]
            steps[name] = {
                "success": int(data["success"]),
                "error": int(data["error"]),
                "success_rate": round((data["success"] / total * 100) if total else 0, 2),
                "avg_ms": round(sum(data["latency_ms"]) / total if total else 0, 2),
            }
        return {
            "total_cycles": self.total_cycles,
            "successful_cycles": self.successful_cycles,
            "by_step": steps,
            "screenshots": self.screenshots[:20],
        }


class PlaywrightWorker:
    """Ejecuta ciclos UI con Playwright en chromium headless/headed."""

    def __init__(
        self,
        frontend_url: str,
        backend_url: str,
        username: str,
        password: str,
        project_name: str,
        language: str,
        headless: bool = True,
        timeout_sec: float = 30,
        editor_timeout_sec: float = 45,
        screenshots_dir: str = "results",
    ):
        self.frontend_url = frontend_url
        self.backend_url = backend_url
        self.username = username
        self.password = password
        self.project_name = project_name
        self.language = language
        self.headless = headless
        self.timeout_ms = int(timeout_sec * 1000)
        self.editor_timeout_ms = int(editor_timeout_sec * 1000)
        self.screenshots_dir = screenshots_dir
        self.stats = UIStats()
        os.makedirs(self.screenshots_dir, exist_ok=True)

    async def run_cycle(self) -> bool:
        """Ejecuta un ciclo completo. Retorna True si todos los pasos fueron exitosos."""
        all_ok = True
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=self.headless)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                ignore_https_errors=True,
            )
            page = await context.new_page()
            page.set_default_timeout(self.timeout_ms)

            try:
                # ── 1. Login ──────────────────────────────────────────
                all_ok &= await self._step_login(page, ts)

                # ── 2. Abrir editor ────────────────────────────────────
                all_ok &= await self._step_open_editor(page)

                # ── 3. Escribir código ─────────────────────────────────
                all_ok &= await self._step_write_code(page)

                # ── 4. Autocompletado LSP ──────────────────────────────
                all_ok &= await self._step_lsp_completion(page)

                # ── 5. Verificar botón ejecución (TODO) ────────────────
                all_ok &= await self._step_execution(page, ts)

                # ── 6. Logout ──────────────────────────────────────────
                all_ok &= await self._step_logout(page)

            except Exception as exc:
                path = os.path.join(self.screenshots_dir, f"crash_{self.username}_{ts}.png")
                try:
                    await page.screenshot(path=path, full_page=True)
                except Exception:
                    pass
                self.stats.screenshots.append(path)
                print(f"[{self.username}] CRASH en ciclo: {exc}")
                all_ok = False

            finally:
                await context.close()
                await browser.close()

        self.stats.finish_cycle(all_ok)
        return all_ok

    # ── Steps internos ──────────────────────────────────────────────────────

    async def _step_login(self, page: Page, ts: str) -> bool:
        step = "login"
        t0 = time.perf_counter()
        try:
            await page.goto(self.frontend_url, wait_until="domcontentloaded")
            await page.wait_for_selector("#username", timeout=self.timeout_ms)
            await page.fill("#username", self.username)
            await page.fill("#password", self.password)
            await page.click('button:has-text("Entrar")')
            await page.wait_for_url("**/projects", timeout=self.timeout_ms)
            await page.wait_for_selector(".selector-shell", timeout=self.timeout_ms)
            latency = (time.perf_counter() - t0) * 1000
            self.stats.record(step, True, latency)
            print(f"  [{self.username}] login OK ({latency:.0f}ms)")
            return True
        except Exception as exc:
            latency = (time.perf_counter() - t0) * 1000
            path = os.path.join(self.screenshots_dir, f"login_fail_{self.username}_{ts}.png")
            await page.screenshot(path=path)
            self.stats.record(step, False, latency, path)
            print(f"  [{self.username}] login FAIL ({latency:.0f}ms): {exc}")
            return False

    async def _step_open_editor(self, page: Page) -> bool:
        step = "editor_load"
        t0 = time.perf_counter()
        try:
            # Esperar a que Angular termine de cargar los proyectos
            await page.wait_for_selector(".project-card", state="visible", timeout=self.timeout_ms)

            # Buscar la card del proyecto de prueba iterando sobre las cards
            cards = page.locator(".project-card")
            count = await cards.count()
            matched_card = None
            for i in range(count):
                card = cards.nth(i)
                h3_text = await card.locator("h3").first.inner_text()
                if self.project_name in h3_text:
                    matched_card = card
                    break

            if matched_card is None:
                print(f"  [{self.username}] Proyecto '{self.project_name}' no encontrado, usando primera card")
                matched_card = cards.first

            await matched_card.wait_for(state="visible", timeout=self.timeout_ms)
            matched_name = await matched_card.locator("h3").first.inner_text()
            print(f"  [{self.username}] Abriendo proyecto '{matched_name.strip()}'...")
            await matched_card.click()
            # Timeout amplio: el frontend crea el contenedor LSP al abrir el editor
            # El proyecto puede tener archivos (.cm-editor) o estar vacío (.empty-project-message)
            await page.wait_for_selector(".cm-editor, .empty-project-message", timeout=self.editor_timeout_ms)
            has_editor = await page.locator(".cm-editor").count() > 0
            if not has_editor:
                print(f"  [{self.username}] Proyecto sin archivos — creando uno nuevo")

            # ── Seleccionar o crear archivo ─────────────────────────
            # Esperar que la lista de archivos se renderice
            await page.wait_for_timeout(1000)

            file_items = page.locator(".file-item")
            if await file_items.count() == 0 or not has_editor:
                # No hay archivos — crear uno nuevo
                default_filename = {
                    "python": "main.py",
                    "typescript": "main.ts",
                    "cpp": "main.cpp",
                }.get(self.language.lower(), "main.txt")

                # Configurar handler para el window.prompt del frontend
                dialog_fired = False

                async def _handle_prompt(dialog):
                    nonlocal dialog_fired
                    dialog_fired = True
                    print(f"  [{self.username}] Dialog prompt detectado, aceptando con '{default_filename}'")
                    await dialog.accept(default_filename)

                page.once("dialog", _handle_prompt)

                nuevo_btn = page.locator("button:has-text('+ Nuevo')")
                btn_count = await nuevo_btn.count()
                print(f"  [{self.username}] Botones '+ Nuevo' encontrados: {btn_count}")
                if btn_count > 0:
                    await nuevo_btn.first.click()
                    await page.wait_for_timeout(2000)
                    if not dialog_fired:
                        print(f"  [{self.username}] WARNING: El dialog no se disparó — creando archivo vía API")
                        await self._create_file_via_api(page, default_filename)
                    # Verificar que ahora hay archivos
                    file_items = page.locator(".file-item")
                    if await file_items.count() == 0:
                        print(f"  [{self.username}] No se pudo crear archivo (sigue vacío)")
                    else:
                        await file_items.first.click()
                        await page.wait_for_timeout(500)
                else:
                    print(f"  [{self.username}] Botón '+ Nuevo' no encontrado")
            else:
                # Seleccionar primer archivo
                await file_items.first.click()
                await page.wait_for_timeout(500)

            file_name = await file_items.first.inner_text()
            print(f"  [{self.username}] Archivo seleccionado: '{file_name.strip()}'")

            latency = (time.perf_counter() - t0) * 1000
            self.stats.record(step, True, latency)
            print(f"  [{self.username}] editor_load OK ({latency:.0f}ms)")
            return True
        except Exception as exc:
            latency = (time.perf_counter() - t0) * 1000
            self.stats.record(step, False, latency)
            print(f"  [{self.username}] editor_load FAIL ({latency:.0f}ms): {exc}")
            return False

    async def _step_write_code(self, page: Page) -> bool:
        step = "write_code"
        t0 = time.perf_counter()
        try:
            code, check_text, _ = LANGUAGE_TEST.get(
                self.language.lower(), LANGUAGE_TEST["python"]
            )
            editor = page.locator(".cm-content")
            await editor.wait_for(state="visible", timeout=self.timeout_ms)
            await editor.click()
            await page.keyboard.press("Control+a")
            await page.keyboard.press("Backspace")
            await page.keyboard.type(code)
            await page.wait_for_timeout(500)
            text = await editor.inner_text()
            if check_text not in text:
                raise RuntimeError(f"Texto '{check_text}' no visible: {text[:80]}")
            latency = (time.perf_counter() - t0) * 1000
            self.stats.record(step, True, latency)
            print(f"  [{self.username}] write_code OK ({latency:.0f}ms, {self.language})")
            return True
        except Exception as exc:
            latency = (time.perf_counter() - t0) * 1000
            self.stats.record(step, False, latency)
            print(f"  [{self.username}] write_code FAIL ({latency:.0f}ms): {exc}")
            return False

    async def _step_lsp_completion(self, page: Page) -> bool:
        step = "lsp_completion"
        t0 = time.perf_counter()
        try:
            _, _, lsp_prefix = LANGUAGE_TEST.get(
                self.language.lower(), LANGUAGE_TEST["python"]
            )
            # Escribir el prefijo una vez al final del contenido
            await page.keyboard.press("End")
            await page.keyboard.press("Enter")
            await page.keyboard.type(lsp_prefix)

            # Espera activa: reintentar autocompletado cada 500ms hasta que LSP responda
            deadline = time.time() + 25
            while time.time() < deadline:
                await page.keyboard.press("Control+Space")
                try:
                    await page.wait_for_selector(
                        ".cm-tooltip-autocomplete", timeout=500
                    )
                    break
                except Exception:
                    await page.keyboard.press("Escape")

            if time.time() >= deadline:
                raise RuntimeError("LSP no respondió después de 25s")

            items = page.locator(".cm-tooltip-autocomplete li")
            count = await items.count()
            if count == 0:
                raise RuntimeError("Popup de autocompletado vacío")
            await page.keyboard.press("Escape")
            latency = (time.perf_counter() - t0) * 1000
            self.stats.record(step, True, latency)
            print(f"  [{self.username}] lsp_completion OK ({latency:.0f}ms, {count} items, {self.language})")
            return True
        except Exception as exc:
            latency = (time.perf_counter() - t0) * 1000
            self.stats.record(step, False, latency)
            print(f"  [{self.username}] lsp_completion FAIL ({latency:.0f}ms): {exc}")
            return False

    async def _create_file_via_api(self, page: Page, filename: str):
        """Crea un archivo directamente vía API del backend (fallback si el dialog no funciona)."""
        try:
            # Obtener project ID de la URL actual (/editor/{id})
            url = page.url
            parts = url.rstrip("/").split("/")
            project_id = parts[-1] if parts else None
            if not project_id or not project_id.isdigit():
                print(f"  [{self.username}] No se pudo extraer project_id de la URL: {url}")
                return

            # Obtener token de auth del localStorage
            token = await page.evaluate("() => localStorage.getItem('access_token')")
            if not token:
                print(f"  [{self.username}] No se encontró access_token en localStorage")
                return

            # Código por defecto según lenguaje
            code, _, _ = LANGUAGE_TEST.get(self.language.lower(), LANGUAGE_TEST["python"])

            # Llamar API para crear archivo
            api = page.context.request
            resp = await api.post(
                f"{self.backend_url}/api/projects/{project_id}/archivos/",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                data=json.dumps({"nombre": filename, "contenido": code}),
            )
            if resp.ok:
                print(f"  [{self.username}] Archivo '{filename}' creado vía API")
                await page.reload(wait_until="domcontentloaded")
                await page.wait_for_timeout(1500)
            else:
                body = await resp.text()
                print(f"  [{self.username}] API falló: {resp.status} {body[:100]}")
        except Exception as exc:
            print(f"  [{self.username}] Error creando archivo vía API: {exc}")

    async def _step_execution(self, page: Page, ts: str) -> bool:
        step = "execution"
        t0 = time.perf_counter()
        try:
            run_btn = page.locator(".btn.run")
            await run_btn.wait_for(state="visible", timeout=self.timeout_ms)
            latency = (time.perf_counter() - t0) * 1000
            self.stats.record(step, True, latency)
            print(f"  [{self.username}] execution (TODO) OK ({latency:.0f}ms)")
            return True
        except Exception as exc:
            latency = (time.perf_counter() - t0) * 1000
            path = os.path.join(self.screenshots_dir, f"exec_fail_{self.username}_{ts}.png")
            await page.screenshot(path=path)
            self.stats.record(step, False, latency, path)
            print(f"  [{self.username}] execution (TODO) FAIL ({latency:.0f}ms): {exc}")
            return False

    async def _step_logout(self, page: Page) -> bool:
        step = "logout"
        t0 = time.perf_counter()
        try:
            logout_btn = page.locator(".btn.logout")
            await logout_btn.wait_for(state="visible", timeout=self.timeout_ms)
            await logout_btn.click()
            await page.wait_for_url("**/auth", timeout=self.timeout_ms)
            latency = (time.perf_counter() - t0) * 1000
            self.stats.record(step, True, latency)
            print(f"  [{self.username}] logout OK ({latency:.0f}ms)")
            return True
        except Exception as exc:
            latency = (time.perf_counter() - t0) * 1000
            self.stats.record(step, False, latency)
            print(f"  [{self.username}] logout FAIL ({latency:.0f}ms): {exc}")
            return False
