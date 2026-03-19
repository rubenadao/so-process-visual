#include <stdio.h>
#include <unistd.h>

int main() {
    fork();
    fork();
    return 0;
}