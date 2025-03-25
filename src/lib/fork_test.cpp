// Test program to verify the custom fork() function

#include <stdio.h>
#include <process.h>

int main() {
    printf("Starting process...\n");
    
    // Call our custom fork function
    int pid = fork();
    
    // This should print "fork!" (from the custom implementation)
    // and then print the process ID (which should be 1)
    printf("Process ID: %d\n", pid);
    
    return 0;
} 