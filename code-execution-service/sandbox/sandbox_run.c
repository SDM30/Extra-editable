#include <errno.h>
#include <seccomp.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static int deny_syscall(scmp_filter_ctx ctx, int syscall_nr) {
    return seccomp_rule_add(ctx, SCMP_ACT_ERRNO(EPERM), syscall_nr, 0);
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "Usage: sandbox-run <program> [args...]\n");
        return 2;
    }

    // Politica por defecto: permitir todo y denegar syscalls sensibles.
    scmp_filter_ctx ctx = seccomp_init(SCMP_ACT_ALLOW);
    if (ctx == NULL) {
        perror("seccomp_init");
        return 1;
    }

    // Bloqueos para impedir creacion de procesos y operaciones de red.
    int blocked[] = {
        SCMP_SYS(fork),
        SCMP_SYS(vfork),
        SCMP_SYS(clone),
#ifdef __NR_clone3
        SCMP_SYS(clone3),
#endif
        SCMP_SYS(socket),
        SCMP_SYS(socketpair),
        SCMP_SYS(connect),
        SCMP_SYS(accept),
        SCMP_SYS(accept4),
        SCMP_SYS(bind),
        SCMP_SYS(listen),
        SCMP_SYS(sendto),
        SCMP_SYS(sendmsg),
        SCMP_SYS(recvfrom),
        SCMP_SYS(recvmsg),
        SCMP_SYS(shutdown),
        SCMP_SYS(setsockopt),
        SCMP_SYS(getsockopt),
        SCMP_SYS(getpeername),
        SCMP_SYS(getsockname)
    };

    size_t count = sizeof(blocked) / sizeof(blocked[0]);
    for (size_t i = 0; i < count; ++i) {
        if (deny_syscall(ctx, blocked[i]) != 0) {
            fprintf(stderr, "Failed adding seccomp rule for syscall %d\n", blocked[i]);
            seccomp_release(ctx);
            return 1;
        }
    }

    // Cargar filtro en el kernel antes de ejecutar el binario del usuario.
    if (seccomp_load(ctx) != 0) {
        perror("seccomp_load");
        seccomp_release(ctx);
        return 1;
    }
    seccomp_release(ctx);

    execvp(argv[1], &argv[1]);
    fprintf(stderr, "execvp failed: %s\n", strerror(errno));
    return 127;
}
