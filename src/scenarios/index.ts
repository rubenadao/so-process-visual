// Scenario manifest - defines order and display names for C code examples
// Import .c files as raw strings using Vite's ?raw suffix

import simpleAddition from './01-simple-addition.c?raw';
import additionFork from './02-addition-fork.c?raw';
import doubleFork from './03-double-fork.c?raw';
import forkBomb from './04-fork-bomb.c?raw';
import forkPidCheck from './05-fork-pid-check.c?raw';
import forkWait from './06-fork-wait.c?raw';
import fork3Sequential from './07-fork-3-sequential.c?raw';
import fork3Concurrent from './08-fork-3-concurrent.c?raw';
import exercise1 from './09-exercise-1.c?raw';
import exercise2 from './10-exercise-2.c?raw';
import exercise3 from './11-exercise-3.c?raw';

export interface Scenario {
  name: string;
  code: string;
}

export const scenarios: Scenario[] = [
  { name: 'Simple Addition', code: simpleAddition },
  { name: 'Addition + Fork', code: additionFork },
  { name: 'Double Fork', code: doubleFork },
  { name: 'Fork Bomb', code: forkBomb },
  { name: 'Fork with PID check', code: forkPidCheck },
  { name: 'Fork + Wait', code: forkWait },
  { name: 'Fork 3 Children (Sequential)', code: fork3Sequential },
  { name: 'Fork 3 Children (Concurrent)', code: fork3Concurrent },
  { name: 'Exercise 1', code: exercise1 },
  { name: 'Exercise 2', code: exercise2 },
  { name: 'Exercise 3', code: exercise3 },
];

export default scenarios;
