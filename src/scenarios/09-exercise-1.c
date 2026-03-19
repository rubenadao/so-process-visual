#include <stdio.h>
#include <unistd.h>

int main() {
    int i = 0;
    int pid;
    pid = fork();
    if (pid == 0) {
        i = i + 1;
        printf("Child: i = %d\n", i);
    } else {
        i = i - 1;
        printf("Parent: i = %d\n", i);
    }
    return 0;
}