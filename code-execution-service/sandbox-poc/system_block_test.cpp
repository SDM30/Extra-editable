#include <cstdlib>
#include <iostream>

int main() {
    std::cout << "Running system(\"echo sandbox-test\")..." << std::endl;
    int rc = std::system("echo sandbox-test");
    std::cout << "system() return code: " << rc << std::endl;

    if (rc != 0) {
        std::cout << "OK: system() was blocked by sandbox." << std::endl;
        return 0;
    }

    std::cerr << "FAIL: system() executed successfully." << std::endl;
    return 1;
}
