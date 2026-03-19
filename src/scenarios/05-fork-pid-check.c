#include <stdio.h>
#include <unistd.h>

int main() {
    int pid = fork();
    if (pid == 0) {
        printf("Child\n");
    } else {
        printf("Parent\n");
    }
    return 0;
}