// PoC de red: intenta crear un socket TCP y conectar a 1.1.1.1:80.
// La prueba es exitosa si el sandbox bloquea socket/connect (errno esperado: EPERM).
#include <arpa/inet.h>
#include <cerrno>
#include <cstring>
#include <iostream>
#include <sys/socket.h>
#include <unistd.h>

int main() {
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) {
        std::cout << "OK: socket() blocked. errno=" << errno
                  << " (" << std::strerror(errno) << ")" << std::endl;
        return 0;
    }

    sockaddr_in addr {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(80);
    inet_pton(AF_INET, "1.1.1.1", &addr.sin_addr);

    int rc = ::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));
    ::close(fd);

    if (rc < 0) {
        std::cout << "OK: connect() blocked. errno=" << errno
                  << " (" << std::strerror(errno) << ")" << std::endl;
        return 0;
    }

    std::cerr << "FAIL: outbound network connection succeeded." << std::endl;
    return 1;
}
