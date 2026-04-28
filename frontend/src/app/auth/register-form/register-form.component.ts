import { Component, EventEmitter, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-register-form',
  templateUrl: './register-form.component.html',
  styleUrls: ['./register-form.component.css'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],  
})
export class RegisterFormComponent {
  @Output() toggleForm = new EventEmitter<void>();

  registerForm: FormGroup;
  errorMessage = '';
  successMessage = '';
  isLoading = false;

  constructor(private fb: FormBuilder, private authService: AuthService) {
    this.registerForm = this.fb.group({
      username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(150)]],
      email:    ['', [Validators.required, Validators.email]],
      nombre:   ['', [Validators.required, Validators.minLength(2), Validators.maxLength(255)]],
      password: ['', [
        Validators.required, 
        Validators.minLength(8),
        Validators.pattern(/\D/) // No puede ser solo números
      ]],
    });
  }

  onRegister(): void {
    if (this.registerForm.invalid) {
      this.errorMessage = 'Completa todos los campos correctamente';
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.authService.register(this.registerForm.value).subscribe({
      next: () => {
        this.isLoading = false;
        this.successMessage = '¡Cuenta creada! Redirigiendo al login...';
        setTimeout(() => this.toggleForm.emit(), 2000);
      },
      error: (err) => {
        this.isLoading = false;
        const errors = err?.error;
        if (errors?.username) this.errorMessage = 'El usuario ya existe.';
        else if (errors?.email) this.errorMessage = 'El correo ya está registrado.';
        else if (errors?.password) this.errorMessage = errors.password[0];
        else this.errorMessage = 'Error al registrar. Intenta de nuevo.';
      }
    });
  }
}
