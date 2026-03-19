#include <stdio.h>
#include <unistd.h>

int main() {
    int pid;
    pid = fork();
    if (pid == 0) {
        printf("Child\n");
    } else {
        printf("Parent\n");
    }
    printf("terminated\n");
    return 0;
}