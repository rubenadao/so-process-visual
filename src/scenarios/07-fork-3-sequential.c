#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    int pid;
    for (int i = 0; i < 3; i++) {
        pid = fork();
        if (pid == 0) {
            printf("Child %d\n", i);
            _exit(0);
        } else {
            wait(NULL);
        }
    }
    printf("Parent done\n");
    return 0;
}