#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    int pid = fork();
    if (pid == 0) {
        printf("Child process\n");
        _exit(0);
    } else {
        wait(NULL);
        printf("Parent done\n");
    }
    return 0;
}