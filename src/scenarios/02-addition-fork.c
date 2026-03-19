#include <stdio.h>
#include <unistd.h>

int main() {
    int i = 2 + 2;
    fork();
    return 0;
}