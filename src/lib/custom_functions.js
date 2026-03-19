// Custom JSCPP functions for the tree-visualizer project

// Add a flag to track if we're currently in a child process
// This prevents forks from happening in child processes
let currentlyProcessingFork = false;

// Track which node is running each fork() call
let lastForkCallId = 0;

// Track pending fork operations to be processed when a step completes
const pendingForks = [];

// Track which nodes are allowed to fork (have completed catch-up)
const nodesAllowedToFork = new Set();

// Enable forking for a specific node (call after catch-up is complete)
export function enableForkingForNode(nodeId) {
  console.log(`Enabling forking for node: ${nodeId}`);
  nodesAllowedToFork.add(nodeId);
}

// Check if a node is allowed to fork
export function canNodeFork(nodeId) {
  // Root node can always fork
  if (nodeId === 'root') return true;
  // Other nodes need to be explicitly enabled
  return nodesAllowedToFork.has(nodeId);
}

// Clear all fork permissions (call when resetting)
export function clearForkPermissions() {
  nodesAllowedToFork.clear();
}

// Custom event bus for inter-component communication
export const forkEventBus = {
  listeners: {},
  
  // Register a listener for a specific event
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  },
  
  // Emit an event with optional data
  emit(event, data) {
    if (this.listeners[event]) {
      console.log(`Emitting ${event} event with data:`, data);
      this.listeners[event].forEach(callback => callback(data));
    } else {
      console.warn(`No listeners for ${event} event`);
    }
  },
  
  // Remove a listener from an event
  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  },
  
  // Queue a fork event to be processed later
  queueFork(forkData) {
    console.log(`Queuing fork event for later processing:`, forkData);
    pendingForks.push(forkData);
  },
  
  // Process any pending fork events
  processPendingForks() {
    if (pendingForks.length > 0) {
      console.log(`Processing ${pendingForks.length} pending fork events`);
      // Process all pending forks
      pendingForks.forEach(forkData => {
        this.emit('fork', forkData);
      });
      // Clear the queue
      pendingForks.length = 0;
    }
  },
  
  // Clear all pending fork operations without processing them
  clearPendingForks() {
    const count = pendingForks.length;
    if (count > 0) {
      console.log(`Clearing ${count} pending fork operations`);
      pendingForks.length = 0;
    }
    // Also reset the fork call counter
    lastForkCallId = 0;
  }
};

const customIncludes = {
  "unistd.h": {
    load: function(rt) {
      // Register the fork() function
      rt.regFunc(function(rt, _this) {
        // Before we do anything, print to stdout
        rt.config.stdio.write("fork called!\n");
        console.log("JSCPP fork() function called");
        
        // Skip if we're already processing a fork to prevent cascade of fork events
        if (currentlyProcessingFork) {
          console.warn('Already processing a fork, skipping to prevent infinite recursion');
          return rt.val(rt.intTypeLiteral, 0);
        }
        
        // CRITICAL: Check if this is a child process via config flag
        // This prevents child processes from forking during catch-up stepping
        // But allow if the node has been explicitly enabled for forking
        if (rt.config.isChildProcess) {
          const nodeId = rt.config.nodeId || '';
          // Check if this node has been enabled for forking (completed catch-up)
          if (!canNodeFork(nodeId)) {
            console.log('Child process during catch-up, returning 0 without forking');
            return rt.val(rt.intTypeLiteral, 0);
          }
          console.log(`Node ${nodeId} is a child process but allowed to fork (completed catch-up)`);
        }
        
        // Get the node ID from the runtime config
        // This is the CRITICAL part - get the exact nodeId of the JSCPP instance calling fork
        const nodeId = rt.config.nodeId || '';
        console.log(`fork called from node ${nodeId}`);
        
        // Skip if nodeId is missing
        if (!nodeId) {
          console.warn('No nodeId available for fork call, skipping');
          return rt.val(rt.intTypeLiteral, 0);
        }
        
        // Check if we're in a child process (should not fork again from same line)
        // Child processes should have a pid variable set to 0
        let isChildProcess = false;
        if (rt.scope && rt.scope[0] && rt.scope[0].variables) {
          const pidVar = rt.scope[0].variables["pid"];
          if (pidVar && pidVar.value === 0) {
            isChildProcess = true;
            console.log(`Node ${nodeId} is a child process (pid=0), skipping fork`);
            return rt.val(rt.intTypeLiteral, 0);
          }
        }
        
        // Set flag to prevent nested fork processing
        currentlyProcessingFork = true;
        
        try {
          // Generate a unique ID for this fork call
          const forkCallId = ++lastForkCallId;
          
          // Create child PID - for the child process, this will be 0
          // For the parent process, this will be some positive number (fork's return value)
          const childPid = forkCallId;  // Use the forkCallId as the child's PID
          
          // Make sure we're using the proper type literal for int
          // Parent returns child's PID (positive number)
          const parentReturnValue = rt.val(rt.intTypeLiteral, childPid);
          
          // Add proper PID to current scope - this happens ONLY when fork() is actually called
          if (rt.scope && rt.scope[0] && rt.scope[0].variables) {
            // We're in the parent process here - parent sees child's PID
            rt.scope[0].variables["pid"] = parentReturnValue;
            console.log(`Set parent process pid variable to ${childPid}`);
          }
          
          // IMPORTANT: Queue fork event with exact nodeId to be processed after stepping
          console.log(`Queuing fork event for specific nodeId=${nodeId}, forkCallId=${forkCallId}`);
          try {
            if (typeof window !== 'undefined') {
              const forkData = {
                forkCallId,
                nodeId,      // Source node ID - this must be exact to ensure we only add child to the right node
                timestamp: Date.now(),
                childPid,    // Child process ID (positive)
                parentPid: 0 // Parent sees child's PID, child sees 0
              };
              
              console.log('Fork data being queued:', forkData);
              // Queue the fork event rather than emitting it immediately
              // This prevents an infinite loop where the child node immediately executes the same fork line
              forkEventBus.queueFork(forkData);
            }
          } catch (error) {
            console.error('Error queuing fork event:', error);
          }
          
          // Parent process returns the child's PID (positive number)
          return parentReturnValue;
        } finally {
          // Always reset the flag
          currentlyProcessingFork = false;
        }
      }, "global", "fork", [], rt.intTypeLiteral);
      
      // Register the _exit() function - terminates process immediately
      rt.regFunc(function(rt, _this, statusCode) {
        const exitCode = statusCode ? statusCode.v : 0;
        console.log(`_exit(${exitCode}) called - terminating process`);
        rt.config.stdio.write(`Process exited with code ${exitCode}\n`);
        // For now, behave like a return - the runtime will handle termination
        rt.exitValue = rt.val(rt.intTypeLiteral, exitCode);
        throw {type: 'return', value: rt.exitValue};
      }, "global", "_exit", [rt.intTypeLiteral], rt.voidTypeLiteral);
    }
  }
};

// Export the custom includes object
export default customIncludes; 