#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    int pid;
    pid = fork();
    if (pid == 0) {
        printf("Child\n");
        _exit(1000);
    } else {
        wait(NULL);
        printf("Parent\n");
    }
    return 0;
}