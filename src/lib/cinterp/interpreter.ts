// Cloneable C Interpreter using Ohm.js
// Designed for fork() simulation with true state cloning

import * as ohm from 'ohm-js';

// The grammar as a string (will be loaded from .ohm file in production)
const grammarSource = `
CSubset {
  Program = PreprocessorDirective* FunctionDef+

  PreprocessorDirective = IncludeAngle | IncludeQuote | DefineDirective
  IncludeAngle = "#" "include" "<" headerName ">"
  IncludeQuote = "#" "include" "\\"" headerName "\\""
  DefineDirective = "#" "define" ident (~newline any)*
  headerName = (~">" ~"\\"" any)+
  newline = "\\n" | "\\r\\n" | "\\r"

  FunctionDef = Type ident "(" ParamList? ")" Block

  ParamList = Param ("," Param)*
  Param = Type ident

  Type = "int" | "char" | "void" | "pid_t"

  Block = "{" Statement* "}"

  Statement = VarDeclStmt
            | AssignStmt
            | ForkStmt
            | WaitStmt
            | ExitStmt
            | PrintfStmt
            | IfStmt
            | WhileStmt
            | ForStmt
            | ReturnStmt
            | ExprStmt
            | BlockStmt

  VarDeclStmt = VarDecl
  AssignStmt = Assignment ";"
  ForkStmt = ForkCall ";"
  WaitStmt = WaitCall ";"
  ExitStmt = ExitCall ";"
  PrintfStmt = PrintfCall ";"
  IfStmt = IfStatement
  WhileStmt = WhileStatement
  ForStmt = ForStatement
  ReturnStmt = ReturnStatement
  ExprStmt = ExprStatement
  BlockStmt = Block

  VarDecl = Type ident VarInit? ";"
  VarInit = "=" Expr

  Assignment = ident "=" Expr

  ForkCall = "fork" "(" ")"
  
  WaitCall = "wait" "(" WaitArg? ")"
  WaitArg = NullLiteral      -- null
          | "&" ident       -- addr
  NullLiteral = "NULL"
  
  ExitCall = "_exit" "(" Expr ")"

  PrintfCall = "printf" "(" stringLiteral PrintfArg* ")"
  PrintfArg = "," Expr

  IfStatement = "if" "(" Expr ")" Statement ElseClause?
  ElseClause = "else" Statement

  WhileStatement = "while" "(" Expr ")" Statement

  ForStatement = "for" "(" ForInit? ";" Expr? ";" ForUpdate? ")" Statement
  ForInit = ForInitVarDecl | ForInitAssign
  ForInitVarDecl = VarDeclNoSemi
  ForInitAssign = Assignment
  ForUpdate = ForUpdateAssign | ForUpdatePostInc | ForUpdatePostDec | ForUpdatePreInc | ForUpdatePreDec
  ForUpdateAssign = Assignment
  ForUpdatePostInc = ident "++"
  ForUpdatePostDec = ident "--"
  ForUpdatePreInc = "++" ident
  ForUpdatePreDec = "--" ident
  VarDeclNoSemi = Type ident VarInit?

  ReturnStatement = "return" Expr? ";"

  ExprStatement = Expr ";"

  Expr = TernaryExpr

  TernaryExpr = LogicalOrExpr "?" Expr ":" Expr  -- ternary
              | LogicalOrExpr                    -- base

  LogicalOrExpr = LogicalOrExpr "||" LogicalAndExpr  -- or
                | LogicalAndExpr                     -- base

  LogicalAndExpr = LogicalAndExpr "&&" EqualityExpr  -- and
                 | EqualityExpr                      -- base

  EqualityExpr = EqualityExpr "==" RelationalExpr  -- eq
               | EqualityExpr "!=" RelationalExpr  -- neq
               | RelationalExpr                    -- base

  RelationalExpr = RelationalExpr "<" AdditiveExpr   -- lt
                 | RelationalExpr ">" AdditiveExpr   -- gt
                 | RelationalExpr "<=" AdditiveExpr  -- lte
                 | RelationalExpr ">=" AdditiveExpr  -- gte
                 | AdditiveExpr                      -- base

  AdditiveExpr = AdditiveExpr "+" MultiplicativeExpr  -- add
               | AdditiveExpr "-" MultiplicativeExpr  -- sub
               | MultiplicativeExpr                   -- base

  MultiplicativeExpr = MultiplicativeExpr "*" UnaryExpr  -- mul
                     | MultiplicativeExpr "/" UnaryExpr  -- div
                     | MultiplicativeExpr "%" UnaryExpr  -- mod
                     | UnaryExpr                         -- base

  UnaryExpr = "!" UnaryExpr  -- not
            | "-" UnaryExpr  -- neg
            | "++" ident     -- preInc
            | "--" ident     -- preDec
            | PostfixExpr    -- base

  PostfixExpr = ident "++"     -- postInc
              | ident "--"     -- postDec
              | PrimaryExpr    -- base

  PrimaryExpr = "(" Expr ")"  -- paren
              | ForkCall      -- fork
              | WaitCall      -- wait
              | ExitCall      -- exit
              | number        -- num
              | stringLiteral -- str
              | ident         -- var

  ident = ~keyword identStart identPart*
  identStart = letter | "_"
  identPart = letter | digit | "_"

  keyword = ("int" | "char" | "void" | "pid_t" | "if" | "else" | "while" | "for" 
            | "return" | "fork" | "wait" | "_exit" | "printf" | "include" | "define" | "NULL") ~identPart

  number = digit+

  stringLiteral = "\\"" stringChar* "\\""
  stringChar = escapeSeq | normalChar
  normalChar = ~"\\"" ~"\\\\" any
  escapeSeq = "\\\\" escapeChar
  escapeChar = "n" | "t" | "r" | "\\\\" | "\\"" | "0"

  space += comment
  comment = lineComment | blockComment
  lineComment = "//" (~newline any)*
  blockComment = "/*" (~"*/" any)* "*/"
}
`;

// ============================================================================
// Types
// ============================================================================

// Source range for precise highlighting (0-based line/col for Ace editor)
export interface SourceRange {
  startLine: number;  // 0-based
  startCol: number;
  endLine: number;    // 0-based
  endCol: number;
}

export interface Variable {
  name: string;
  type: string;
  value: number | string;
}

// Micro-operation types for expression-level stepping
type MicroOpType = 
  | 'highlight'      // Just highlight, no action
  | 'eval_literal'   // Evaluate a literal
  | 'eval_var'       // Read a variable
  | 'eval_binary'    // Compute binary operation (values already on stack)
  | 'eval_unary'     // Compute unary operation
  | 'assign'         // Assign top of value stack to variable
  | 'var_decl'       // Declare variable with top of value stack
  | 'if_branch'      // Branch based on condition result
  | 'printf'         // Execute printf
  | 'fork'           // Execute fork
  | 'wait'           // Execute wait (wait for child to terminate)
  | 'return'         // Execute return
  | 'while_check'    // Check while condition and splice body
  | 'for_init'       // Initialize for loop
  | 'for_cont'       // For loop continuation (update + condition)
  | 'noop';          // No operation (for function entry, etc.)

interface MicroOp {
  type: MicroOpType;
  range: SourceRange | null;  // What to highlight
  node: ASTNode;              // Full AST node for context
  data?: any;                 // Additional data (variable name, operator, etc.)
}

export interface InterpreterState {
  // Variables in current scope
  variables: Map<string, Variable>;
  // Program counter - which statement we're about to execute
  pc: number;
  // Micro-step within current statement
  microOps: MicroOp[];        // Queue of pending micro-operations
  microIndex: number;         // Current position in microOps
  valueStack: (number | string)[];  // Intermediate values during expression eval
  // Output buffer
  output: string[];
  // Is the program finished?
  finished: boolean;
  // Exit code (if finished)
  exitCode: number;
  // Current line number (1-based, for visualization)
  currentLine: number;
  // Current highlight range (0-based, for precise highlighting)
  currentRange: SourceRange | null;
  // PID for this process (parent gets child PID, child gets 0)
  pid: number;
  // Parent PID (-1 for root process)
  parentPid: number;
  // Next PID to assign to children
  nextChildPid: number;
  // Dynamically modified statements list (while/for loops splice into this)
  statements?: ASTNode[];
  // Is this process blocked waiting for a child?
  waiting: boolean;
}

export interface ForkEvent {
  childState: InterpreterState;
  childPid: number;
  forkLine: number;
}

// Result of wait() call - returned by onWait callback
export interface WaitResult {
  childPid: number;      // PID of terminated child
  exitStatus: number;    // Exit status of the child
}

// Callback type for wait() - returns terminated child info or null if none available
export type WaitCallback = (parentPid: number) => WaitResult | null;

// AST node with source location
interface ASTNode {
  type: string;
  line: number;
  range?: SourceRange;  // Precise source range for highlighting
  children?: ASTNode[];
  value?: any;
  [key: string]: any;
}

// ============================================================================
// Parser
// ============================================================================

let grammar: ohm.Grammar | null = null;
let semantics: ohm.Semantics | null = null;
let currentSourceCode: string = '';
let lineOffsets: number[] = [];

// Build line offset table for fast index-to-line/col conversion
function buildLineOffsets(source: string): void {
  currentSourceCode = source;
  lineOffsets = [0]; // Line 0 starts at offset 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      lineOffsets.push(i + 1);
    }
  }
}

// Convert character offset to 0-based line/col
function offsetToLineCol(offset: number): { line: number; col: number } {
  // Binary search for the line
  let low = 0, high = lineOffsets.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (lineOffsets[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { line: low, col: offset - lineOffsets[low] };
}

// Get source range from Ohm node's source property
function getSourceRange(node: any): SourceRange {
  const start = offsetToLineCol(node.source.startIdx);
  const end = offsetToLineCol(node.source.endIdx);
  return {
    startLine: start.line,
    startCol: start.col,
    endLine: end.line,
    endCol: end.col,
  };
}

function getGrammar(): ohm.Grammar {
  if (!grammar) {
    grammar = ohm.grammar(grammarSource);
  }
  return grammar;
}

function getSemantics(): ohm.Semantics {
  if (!semantics) {
    const g = getGrammar();
    semantics = g.createSemantics().addOperation('toAST', {
      Program(directives, funcs) {
        return {
          type: 'Program',
          line: 1,
          directives: directives.children.map((d: any) => d.toAST()),
          functions: funcs.children.map((f: any) => f.toAST()),
        };
      },

      // Preprocessor directives
      IncludeAngle(_hash, _include, _lt, name, _gt) {
        return { type: 'Include', line: this.source.getLineAndColumn().lineNum, name: name.sourceString };
      },
      IncludeQuote(_hash, _include, _q1, name, _q2) {
        return { type: 'Include', line: this.source.getLineAndColumn().lineNum, name: name.sourceString };
      },
      DefineDirective(_hash, _define, name, _value) {
        return { type: 'Define', line: this.source.getLineAndColumn().lineNum, name: name.sourceString };
      },

      FunctionDef(returnType, name, _lp, params, _rp, body) {
        // Get just the signature range (up to opening brace)
        const sigStart = offsetToLineCol(this.source.startIdx);
        const bodyStart = offsetToLineCol(body.source.startIdx);
        return {
          type: 'FunctionDef',
          line: this.source.getLineAndColumn().lineNum,
          range: {
            startLine: sigStart.line,
            startCol: sigStart.col,
            endLine: bodyStart.line,
            endCol: bodyStart.col,
          },
          returnType: returnType.sourceString,
          name: name.sourceString,
          params: params.children.length > 0 ? params.children[0].toAST() : [],
          body: body.toAST(),
        };
      },

      ParamList(first, _comma, rest) {
        return [first.toAST(), ...rest.children.map((p: any) => p.toAST())];
      },

      Param(type, name) {
        return {
          type: 'Param',
          line: this.source.getLineAndColumn().lineNum,
          paramType: type.sourceString,
          name: name.sourceString,
        };
      },

      Block(_lb, statements, _rb) {
        return {
          type: 'Block',
          line: this.source.getLineAndColumn().lineNum,
          statements: statements.children.map((s: any) => s.toAST()),
        };
      },

      // Statement wrapper rules
      VarDeclStmt(decl) { return decl.toAST(); },
      AssignStmt(assign, _semi) { 
        return {
          ...assign.toAST(),
          line: this.source.getLineAndColumn().lineNum,
        };
      },
      ForkStmt(fork, _semi) { return fork.toAST(); },
      WaitStmt(wait, _semi) { return wait.toAST(); },
      ExitStmt(exit, _semi) { return exit.toAST(); },
      PrintfStmt(printf, _semi) { return printf.toAST(); },
      IfStmt(stmt) { return stmt.toAST(); },
      WhileStmt(stmt) { return stmt.toAST(); },
      ForStmt(stmt) { return stmt.toAST(); },
      ReturnStmt(stmt) { return stmt.toAST(); },
      ExprStmt(stmt) { return stmt.toAST(); },
      BlockStmt(block) { return block.toAST(); },

      VarDecl(type, name, init, _semi) {
        return {
          type: 'VarDecl',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
          varType: type.sourceString,
          name: name.sourceString,
          init: init.children.length > 0 ? init.children[0].toAST() : null,
        };
      },

      VarInit(_eq, expr) {
        return expr.toAST();
      },

      Assignment(name, _eq, expr) {
        return {
          type: 'Assignment',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
          name: name.sourceString,
          value: expr.toAST(),
        };
      },

      ForkCall(_fork, _lp, _rp) {
        return {
          type: 'ForkCall',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
        };
      },

      WaitCall(_wait, _lp, arg, _rp) {
        return {
          type: 'WaitCall',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
          statusArg: arg.children.length > 0 ? arg.children[0].toAST() : null,
        };
      },

      ExitCall(_exit, _lp, expr, _rp) {
        return {
          type: 'ExitCall',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
          exitCode: expr.toAST(),
        };
      },

      WaitArg_null(nullLit) {
        return { type: 'NullArg' };
      },

      WaitArg_addr(_amp, name) {
        return { type: 'AddressArg', varName: name.sourceString };
      },

      NullLiteral(_null) {
        return { type: 'NullLiteral', value: null };
      },

      PrintfCall(_printf, _lp, format, args, _rp) {
        return {
          type: 'PrintfCall',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
          format: format.toAST(),
          args: args.children.map((a: any) => a.toAST()),
        };
      },

      PrintfArg(_comma, expr) {
        return expr.toAST();
      },

      IfStatement(_if, _lp, cond, _rp, thenStmt, elseClause) {
        return {
          type: 'IfStatement',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
          condition: cond.toAST(),
          then: thenStmt.toAST(),
          else: elseClause.children.length > 0 ? elseClause.children[0].toAST() : null,
        };
      },

      ElseClause(_else, stmt) {
        return stmt.toAST();
      },

      WhileStatement(_while, _lp, cond, _rp, body) {
        return {
          type: 'WhileStatement',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
          condition: cond.toAST(),
          body: body.toAST(),
        };
      },

      ForStatement(_for, _lp, init, _s1, cond, _s2, update, _rp, body) {
        return {
          type: 'ForStatement',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
          init: init.children.length > 0 ? init.children[0].toAST() : null,
          condition: cond.children.length > 0 ? cond.children[0].toAST() : null,
          update: update.children.length > 0 ? update.children[0].toAST() : null,
          body: body.toAST(),
        };
      },

      // ForInit alternatives
      ForInitVarDecl(decl) { return decl.toAST(); },
      ForInitAssign(assign) { return assign.toAST(); },

      // ForUpdate alternatives
      ForUpdateAssign(assign) { return assign.toAST(); },
      ForUpdatePostInc(name, _op) {
        return { type: 'PostIncrement', line: this.source.getLineAndColumn().lineNum, name: name.sourceString };
      },
      ForUpdatePostDec(name, _op) {
        return { type: 'PostDecrement', line: this.source.getLineAndColumn().lineNum, name: name.sourceString };
      },
      ForUpdatePreInc(_op, name) {
        return { type: 'PreIncrement', line: this.source.getLineAndColumn().lineNum, name: name.sourceString };
      },
      ForUpdatePreDec(_op, name) {
        return { type: 'PreDecrement', line: this.source.getLineAndColumn().lineNum, name: name.sourceString };
      },

      VarDeclNoSemi(type, name, init) {
        return {
          type: 'VarDecl',
          line: this.source.getLineAndColumn().lineNum,
          varType: type.sourceString,
          name: name.sourceString,
          init: init.children.length > 0 ? init.children[0].toAST() : null,
        };
      },

      ReturnStatement(_return, expr, _semi) {
        return {
          type: 'ReturnStatement',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
          value: expr.children.length > 0 ? expr.children[0].toAST() : null,
        };
      },

      ExprStatement(expr, _semi) {
        return {
          type: 'ExprStatement',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
          expr: expr.toAST(),
        };
      },

      // Expressions
      TernaryExpr_ternary(cond, _q, thenExpr, _c, elseExpr) {
        return {
          type: 'TernaryExpr',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
          condition: cond.toAST(),
          then: thenExpr.toAST(),
          else: elseExpr.toAST(),
        };
      },

      LogicalOrExpr_or(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '||', left: left.toAST(), right: right.toAST() };
      },

      LogicalAndExpr_and(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '&&', left: left.toAST(), right: right.toAST() };
      },

      EqualityExpr_eq(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '==', left: left.toAST(), right: right.toAST() };
      },
      EqualityExpr_neq(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '!=', left: left.toAST(), right: right.toAST() };
      },

      RelationalExpr_lt(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '<', left: left.toAST(), right: right.toAST() };
      },
      RelationalExpr_gt(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '>', left: left.toAST(), right: right.toAST() };
      },
      RelationalExpr_lte(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '<=', left: left.toAST(), right: right.toAST() };
      },
      RelationalExpr_gte(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '>=', left: left.toAST(), right: right.toAST() };
      },

      AdditiveExpr_add(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '+', left: left.toAST(), right: right.toAST() };
      },
      AdditiveExpr_sub(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '-', left: left.toAST(), right: right.toAST() };
      },

      MultiplicativeExpr_mul(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '*', left: left.toAST(), right: right.toAST() };
      },
      MultiplicativeExpr_div(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '/', left: left.toAST(), right: right.toAST() };
      },
      MultiplicativeExpr_mod(left, _op, right) {
        return { type: 'BinaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '%', left: left.toAST(), right: right.toAST() };
      },

      UnaryExpr_not(_op, expr) {
        return { type: 'UnaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '!', expr: expr.toAST() };
      },
      UnaryExpr_neg(_op, expr) {
        return { type: 'UnaryExpr', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), op: '-', expr: expr.toAST() };
      },
      UnaryExpr_preInc(_op, name) {
        return { type: 'PreIncrement', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), name: name.sourceString };
      },
      UnaryExpr_preDec(_op, name) {
        return { type: 'PreDecrement', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), name: name.sourceString };
      },

      PostfixExpr_postInc(name, _op) {
        return { type: 'PostIncrement', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), name: name.sourceString };
      },
      PostfixExpr_postDec(name, _op) {
        return { type: 'PostDecrement', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), name: name.sourceString };
      },

      PrimaryExpr_paren(_lp, expr, _rp) { return expr.toAST(); },
      PrimaryExpr_fork(forkCall) { return forkCall.toAST(); },
      PrimaryExpr_wait(waitCall) { return waitCall.toAST(); },
      PrimaryExpr_exit(exitCall) { return exitCall.toAST(); },
      PrimaryExpr_num(num) {
        return { type: 'NumberLiteral', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), value: parseInt(num.sourceString, 10) };
      },
      PrimaryExpr_str(str) { return str.toAST(); },
      PrimaryExpr_var(name) {
        return { type: 'Variable', line: this.source.getLineAndColumn().lineNum, range: getSourceRange(this), name: name.sourceString };
      },

      stringLiteral(_q1, chars, _q2) {
        return {
          type: 'StringLiteral',
          line: this.source.getLineAndColumn().lineNum,
          range: getSourceRange(this),
          value: chars.sourceString.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r'),
        };
      },

      ident(_start, _rest) { return this.sourceString; },
      number(_digits) { return parseInt(this.sourceString, 10); },

      _terminal() { return this.sourceString; },
      _nonterminal(...children: any[]) {
        if (children.length === 1) {
          return children[0].toAST();
        }
        return children.map((c: any) => c.toAST());
      },
    });
  }
  return semantics;
}

export function parse(code: string): ASTNode {
  buildLineOffsets(code);  // Build line offset table for range calculation
  const g = getGrammar();
  const match = g.match(code);
  if (match.failed()) {
    throw new Error(`Parse error: ${match.message}`);
  }
  const s = getSemantics();
  return s(match).toAST();
}

// ============================================================================
// Interpreter
// ============================================================================

export class CInterpreter {
  private ast: ASTNode;
  private state: InterpreterState;
  private statements: ASTNode[] = [];
  private onFork: ((event: ForkEvent) => void) | null = null;
  private onWait: WaitCallback | null = null;
  private onOutput: ((text: string) => void) | null = null;
  public nodeId: string;
  public code: string;

  constructor(code: string, nodeId: string = 'root') {
    this.code = code;
    this.ast = parse(code);
    this.nodeId = nodeId;
    
    // Extract all statements from main function
    const mainFunc = this.ast.functions?.find((f: ASTNode) => f.name === 'main');
    if (!mainFunc) {
      throw new Error('No main() function found');
    }
    
    // Add synthetic "entry" statement at main() line, then flatten body statements
    // Add synthetic "entry" statement at main() line with proper range
    const entryStmt: ASTNode = { 
      type: 'FunctionEntry', 
      line: mainFunc.line,
      range: mainFunc.range  // Use the function signature range
    };
    this.statements = [entryStmt, ...this.flattenStatements(mainFunc.body)];
    
    // Initialize state
    this.state = this.createInitialState();
  }

  private createInitialState(): InterpreterState {
    const firstStmt = this.statements[0];
    const initialOps = firstStmt ? this.generateMicroOps(firstStmt) : [];
    return {
      variables: new Map(),
      pc: 0,
      microOps: initialOps,
      microIndex: 0,
      valueStack: [],
      output: [],
      finished: false,
      exitCode: 0,
      currentLine: firstStmt?.line || 1,
      currentRange: initialOps[0]?.range || firstStmt?.range || null,
      pid: 1000, // Root process has PID 1000
      parentPid: -1, // Root has no parent
      nextChildPid: 1001,
      waiting: false,
    };
  }

  // Generate micro-operations for a statement (expression-level stepping)
  private generateMicroOps(stmt: ASTNode): MicroOp[] {
    const ops: MicroOp[] = [];
    
    // Helper to recursively generate ops for an expression (post-order for evaluation)
    const genExprOps = (expr: ASTNode): void => {
      if (!expr) return;
      
      switch (expr.type) {
        case 'NumberLiteral':
          ops.push({ 
            type: 'eval_literal', 
            range: expr.range || null, 
            node: expr,
            data: { value: expr.value }
          });
          break;
          
        case 'StringLiteral':
          ops.push({ 
            type: 'eval_literal', 
            range: expr.range || null, 
            node: expr,
            data: { value: expr.value }
          });
          break;
          
        case 'Variable':
          ops.push({ 
            type: 'eval_var', 
            range: expr.range || null, 
            node: expr,
            data: { name: expr.name }
          });
          break;
          
        case 'BinaryExpr':
          // Evaluate left, then right, then show/compute the whole expression
          genExprOps(expr.left);
          genExprOps(expr.right);
          ops.push({ 
            type: 'eval_binary', 
            range: expr.range || null, 
            node: expr,
            data: { op: expr.op }
          });
          break;
          
        case 'UnaryExpr':
          genExprOps(expr.expr);
          ops.push({ 
            type: 'eval_unary', 
            range: expr.range || null, 
            node: expr,
            data: { op: expr.op }
          });
          break;
          
        case 'PreIncrement':
        case 'PreDecrement':
          ops.push({ 
            type: 'eval_unary', 
            range: expr.range || null, 
            node: expr,
            data: { op: expr.type === 'PreIncrement' ? '++pre' : '--pre', name: expr.name }
          });
          break;
          
        case 'PostIncrement':
        case 'PostDecrement':
          ops.push({ 
            type: 'eval_unary', 
            range: expr.range || null, 
            node: expr,
            data: { op: expr.type === 'PostIncrement' ? '++post' : '--post', name: expr.name }
          });
          break;
          
        case 'TernaryExpr':
          // For ternary, just evaluate condition for now (branching is complex)
          genExprOps(expr.condition);
          break;
          
        case 'ForkCall':
          ops.push({ 
            type: 'fork', 
            range: expr.range || null, 
            node: expr 
          });
          break;
          
        case 'WaitCall':
          ops.push({ 
            type: 'wait', 
            range: expr.range || null, 
            node: expr,
            data: { statusArg: expr.statusArg }
          });
          break;
          
        default:
          // Unknown expression - just highlight it
          ops.push({ 
            type: 'highlight', 
            range: expr.range || null, 
            node: expr 
          });
      }
    };
    
    switch (stmt.type) {
      case 'FunctionEntry':
        ops.push({ type: 'noop', range: stmt.range || null, node: stmt });
        break;
        
      case 'VarDecl':
        if (stmt.init) {
          genExprOps(stmt.init);
        } else {
          // No initializer - push 0
          ops.push({ type: 'eval_literal', range: null, node: stmt, data: { value: 0 } });
        }
        ops.push({ 
          type: 'var_decl', 
          range: stmt.range || null, 
          node: stmt,
          data: { name: stmt.name, varType: stmt.varType }
        });
        break;
        
      case 'Assignment':
        genExprOps(stmt.value);
        ops.push({ 
          type: 'assign', 
          range: stmt.range || null, 
          node: stmt,
          data: { name: stmt.name }
        });
        break;
        
      case 'ExprStatement':
        genExprOps(stmt.expr);
        break;
        
      case 'PrintfCall':
        // Evaluate all arguments first
        for (const arg of stmt.args || []) {
          genExprOps(arg);
        }
        ops.push({ 
          type: 'printf', 
          range: stmt.range || null, 
          node: stmt,
          data: { format: stmt.format?.value, argCount: (stmt.args || []).length }
        });
        break;
        
      case 'ForkCall':
        ops.push({ 
          type: 'fork', 
          range: stmt.range || null, 
          node: stmt 
        });
        break;
        
      case 'WaitCall':
        ops.push({ 
          type: 'wait', 
          range: stmt.range || null, 
          node: stmt,
          data: { statusArg: stmt.statusArg }
        });
        break;
        
      case 'ExitCall':
        // Evaluate the exit code expression first
        if (stmt.exitCode) {
          genExprOps(stmt.exitCode);
        } else {
          ops.push({ type: 'eval_literal', range: null, node: stmt, data: { value: 0 } });
        }
        ops.push({ 
          type: 'exit', 
          range: stmt.range || null, 
          node: stmt 
        });
        break;
        
      case 'ReturnStatement':
        if (stmt.value) {
          genExprOps(stmt.value);
        } else {
          ops.push({ type: 'eval_literal', range: null, node: stmt, data: { value: 0 } });
        }
        ops.push({ 
          type: 'return', 
          range: stmt.range || null, 
          node: stmt 
        });
        break;
        
      case 'IfStatement':
        // For if, we highlight the condition and then branch
        genExprOps(stmt.condition);
        ops.push({ 
          type: 'if_branch', 
          range: stmt.range || null, 
          node: stmt 
        });
        break;
        
      case 'WhileStatement':
        // Evaluate condition, then the micro-op handler will splice body + re-check
        genExprOps(stmt.condition);
        ops.push({
          type: 'while_check',
          range: stmt.range || null,
          node: stmt
        });
        break;
        
      case 'ForStatement':
        // First time: execute init, eval condition, handler splices body + continuation
        ops.push({
          type: 'for_init',
          range: stmt.range || null,
          node: stmt
        });
        break;

      case 'ForContinuation':
        // Execute update, check condition, re-splice if true
        ops.push({
          type: 'for_cont',
          range: stmt.range || null,
          node: stmt
        });
        break;
        
      default:
        ops.push({ 
          type: 'highlight', 
          range: stmt.range || null, 
          node: stmt 
        });
    }
    
    return ops;
  }

  // Flatten nested blocks into a linear list of statements
  private flattenStatements(block: ASTNode): ASTNode[] {
    const result: ASTNode[] = [];
    
    const flatten = (node: ASTNode) => {
      if (node.type === 'Block') {
        for (const stmt of node.statements || []) {
          flatten(stmt);
        }
      } else {
        result.push(node);
      }
    };
    
    flatten(block);
    return result;
  }

  // ============================================================================
  // STATE CLONING - The key feature!
  // ============================================================================

  /**
   * Create a deep clone of the current interpreter state.
   * This is what makes fork() work correctly.
   */
  cloneState(): InterpreterState {
    const clonedVars = new Map<string, Variable>();
    for (const [name, v] of this.state.variables) {
      clonedVars.set(name, { ...v });
    }
    
    return {
      variables: clonedVars,
      pc: this.state.pc,
      microOps: [...this.state.microOps],
      microIndex: this.state.microIndex,
      valueStack: [...this.state.valueStack],
      output: [...this.state.output],
      finished: this.state.finished,
      exitCode: this.state.exitCode,
      currentLine: this.state.currentLine,
      currentRange: this.state.currentRange ? { ...this.state.currentRange } : null,
      pid: this.state.pid,
      parentPid: this.state.parentPid,
      nextChildPid: this.state.nextChildPid,
      statements: [...this.statements],
      waiting: this.state.waiting,
    };
  }

  /**
   * Create a new interpreter instance from a cloned state.
   * Used after fork() to create the child process.
   */
  static fromState(code: string, state: InterpreterState, nodeId: string): CInterpreter {
    const interp = new CInterpreter(code, nodeId);
    
    // Restore the dynamically-modified statements array from the parent
    if (state.statements) {
      interp.statements = [...state.statements];
    }
    
    // Replace the initial state with the cloned state
    interp.state = {
      variables: new Map(state.variables),
      pc: state.pc,
      microOps: [...state.microOps],
      microIndex: state.microIndex,
      valueStack: [...state.valueStack],
      output: [...state.output],
      finished: state.finished,
      exitCode: state.exitCode,
      currentLine: state.currentLine,
      currentRange: state.currentRange ? { ...state.currentRange } : null,
      pid: state.pid,
      parentPid: state.parentPid,
      nextChildPid: state.nextChildPid,
      waiting: state.waiting,
    };
    
    return interp;
  }

  // ============================================================================
  // Event handlers
  // ============================================================================

  setOnFork(handler: (event: ForkEvent) => void) {
    this.onFork = handler;
  }

  setOnWait(handler: WaitCallback) {
    this.onWait = handler;
  }

  setOnOutput(handler: (text: string) => void) {
    this.onOutput = handler;
  }

  // Line state is managed internally - read via getCurrentLine() after step()

  // ============================================================================
  // Execution
  // ============================================================================

  /**
   * Execute one micro-step. This is the granular stepping unit.
   * Returns true if there are more steps to execute.
   */
  step(): boolean {
    if (this.state.finished) {
      return false;
    }

    if (this.state.pc >= this.statements.length) {
      this.state.finished = true;
      this.state.exitCode = 0;
      return false;
    }

    // If there are no micro-ops queued, generate them for the current statement
    if (this.state.microOps.length === 0 || this.state.microIndex >= this.state.microOps.length) {
      const stmt = this.statements[this.state.pc];
      this.state.microOps = this.generateMicroOps(stmt);
      this.state.microIndex = 0;
      this.state.valueStack = [];
    }

    // Execute the current micro-op
    const op = this.state.microOps[this.state.microIndex];
    console.log(`[${this.nodeId}] micro-step: pc=${this.state.pc}, micro=${this.state.microIndex}/${this.state.microOps.length}, type=${op.type}, range=${op.range ? `${op.range.startLine}:${op.range.startCol}-${op.range.endLine}:${op.range.endCol}` : 'null'}`);
    
    // Update current highlight range
    if (op.range) {
      this.state.currentRange = op.range;
      this.state.currentLine = op.node.line;
    }

    this.executeMicroOp(op);
    
    // Don't advance if we're blocked on wait()
    if (!this.state.waiting) {
      this.state.microIndex++;
    }

    // If we've finished all micro-ops for this statement, advance to the next
    if (this.state.microIndex >= this.state.microOps.length) {
      this.state.pc++;
      this.state.microOps = [];
      this.state.microIndex = 0;
      this.state.valueStack = [];

      // Pre-load the next statement's first micro-op range for getCurrentRange()
      if (this.state.pc < this.statements.length) {
        const nextStmt = this.statements[this.state.pc];
        const nextOps = this.generateMicroOps(nextStmt);
        this.state.microOps = nextOps;
        this.state.microIndex = 0;
        if (nextOps[0]?.range) {
          this.state.currentRange = nextOps[0].range;
          this.state.currentLine = nextStmt.line;
        }
      } else {
        this.state.finished = true;
      }
    }

    return !this.state.finished;
  }

  /**
   * Execute a single micro-operation
   */
  private executeMicroOp(op: MicroOp): void {
    switch (op.type) {
      case 'noop':
      case 'highlight':
        // Do nothing, just highlighting
        break;
        
      case 'eval_literal':
        this.state.valueStack.push(op.data.value);
        break;
        
      case 'eval_var': {
        const v = this.state.variables.get(op.data.name);
        this.state.valueStack.push(v ? v.value as number : 0);
        break;
      }
        
      case 'eval_binary': {
        const right = this.state.valueStack.pop() as number || 0;
        const left = this.state.valueStack.pop() as number || 0;
        const result = this.computeBinaryOp(left, op.data.op, right);
        this.state.valueStack.push(result);
        break;
      }
        
      case 'eval_unary': {
        if (op.data.op === '++pre' || op.data.op === '--pre') {
          const v = this.state.variables.get(op.data.name);
          if (v) {
            v.value = (v.value as number) + (op.data.op === '++pre' ? 1 : -1);
            this.state.valueStack.push(v.value as number);
          }
        } else if (op.data.op === '++post' || op.data.op === '--post') {
          const v = this.state.variables.get(op.data.name);
          if (v) {
            const oldVal = v.value as number;
            v.value = oldVal + (op.data.op === '++post' ? 1 : -1);
            this.state.valueStack.push(oldVal);
          }
        } else {
          const val = this.state.valueStack.pop() as number || 0;
          this.state.valueStack.push(op.data.op === '!' ? (val ? 0 : 1) : -val);
        }
        break;
      }
        
      case 'var_decl': {
        const value = this.state.valueStack.pop() ?? 0;
        this.state.variables.set(op.data.name, {
          name: op.data.name,
          type: op.data.varType,
          value: value as number,
        });
        break;
      }
        
      case 'assign': {
        const value = this.state.valueStack.pop() ?? 0;
        const v = this.state.variables.get(op.data.name);
        if (v) {
          v.value = value as number;
        } else {
          this.state.variables.set(op.data.name, {
            name: op.data.name,
            type: 'int',
            value: value as number,
          });
        }
        break;
      }
        
      case 'printf': {
        const argCount = op.data.argCount || 0;
        const args: (number | string)[] = [];
        for (let i = 0; i < argCount; i++) {
          args.unshift(this.state.valueStack.pop() ?? 0);
        }
        let format = op.data.format as string;
        let argIndex = 0;
        let output = format.replace(/%d|%i|%s|%c/g, (match: string) => {
          if (argIndex >= args.length) return match;
          const arg = args[argIndex++];
          switch (match) {
            case '%d': case '%i': return String(arg);
            case '%s': return String(arg);
            case '%c': return String.fromCharCode(arg as number);
            default: return match;
          }
        });
        if (this.onOutput) {
          this.onOutput(output);
        }
        this.state.output.push(output);
        break;
      }
        
      case 'fork': {
        const childPid = this.executeFork(op.node);
        // Push parent's return value (childPid) onto stack so fork() works in expressions
        this.state.valueStack.push(childPid);
        break;
      }
      
      case 'wait': {
        const result = this.executeWait(op.node, op.data?.statusArg);
        if (result === -1) {
          // No child has terminated yet - block (waiting flag prevents advancement)
          this.state.waiting = true;
        } else {
          // Child terminated - push PID onto stack and continue
          this.state.waiting = false;
          this.state.valueStack.push(result);
        }
        break;
      }
      
      case 'exit': {
        // _exit() syscall - terminate immediately with given exit code
        const code = this.state.valueStack.pop() ?? 0;
        this.state.exitCode = code as number;
        this.state.finished = true;
        // Clear remaining micro-ops so we advance properly
        this.state.microIndex = this.state.microOps.length;
        break;
      }
        
      case 'return': {
        const value = this.state.valueStack.pop() ?? 0;
        this.state.exitCode = value as number;
        this.state.finished = true;
        // Clear remaining micro-ops so we advance properly
        this.state.microIndex = this.state.microOps.length;
        break;
      }
        
      case 'if_branch': {
        const condValue = this.state.valueStack.pop() ?? 0;
        const stmt = op.node;
        if (condValue) {
          // Execute then branch - insert its statements
          const thenStmts = stmt.then.type === 'Block' 
            ? this.flattenStatements(stmt.then) 
            : [stmt.then];
          // Insert after current statement
          this.statements.splice(this.state.pc + 1, 0, ...thenStmts);
        } else if (stmt.else) {
          const elseStmts = stmt.else.type === 'Block' 
            ? this.flattenStatements(stmt.else) 
            : [stmt.else];
          this.statements.splice(this.state.pc + 1, 0, ...elseStmts);
        }
        break;
      }
        
      case 'while_check': {
        const condValue = this.state.valueStack.pop() ?? 0;
        const stmt = op.node;
        if (condValue) {
          // Splice body + re-check this while statement
          const bodyStmts = this.flattenStatements(stmt.body);
          this.statements.splice(this.state.pc + 1, 0, ...bodyStmts, stmt);
        }
        break;
      }
        
      case 'for_init': {
        const stmt = op.node;
        // Execute init
        if (stmt.init) {
          if (stmt.init.type === 'VarDecl') {
            const value = stmt.init.init ? this.evaluateExpr(stmt.init.init) : 0;
            this.state.variables.set(stmt.init.name, {
              name: stmt.init.name,
              type: stmt.init.varType,
              value: value,
            });
          } else {
            const value = this.evaluateExpr(stmt.init.value);
            const v = this.state.variables.get(stmt.init.name);
            if (v) v.value = value;
          }
        }
        // Check condition
        const condition = stmt.condition ? this.evaluateExpr(stmt.condition) : true;
        if (condition) {
          const bodyStmts = this.flattenStatements(stmt.body);
          const forCont: ASTNode = {
            type: 'ForContinuation',
            line: stmt.line,
            range: stmt.range,
            condition: stmt.condition,
            update: stmt.update,
            body: stmt.body,
          };
          this.statements.splice(this.state.pc + 1, 0, ...bodyStmts, forCont);
        }
        break;
      }
        
      case 'for_cont': {
        const stmt = op.node;
        // Execute update
        if (stmt.update) {
          if (stmt.update.type === 'Assignment') {
            const value = this.evaluateExpr(stmt.update.value);
            const v = this.state.variables.get(stmt.update.name);
            if (v) v.value = value;
          } else {
            this.evaluateExpr(stmt.update);
          }
        }
        // Check condition
        const condition = stmt.condition ? this.evaluateExpr(stmt.condition) : true;
        if (condition) {
          const bodyStmts = this.flattenStatements(stmt.body);
          const forCont: ASTNode = {
            type: 'ForContinuation',
            line: stmt.line,
            range: stmt.range,
            condition: stmt.condition,
            update: stmt.update,
            body: stmt.body,
          };
          this.statements.splice(this.state.pc + 1, 0, ...bodyStmts, forCont);
        }
        break;
      }
    }
  }

  private computeBinaryOp(left: number, op: string, right: number): number {
    switch (op) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': return right !== 0 ? Math.trunc(left / right) : 0;
      case '%': return right !== 0 ? left % right : 0;
      case '==': return left === right ? 1 : 0;
      case '!=': return left !== right ? 1 : 0;
      case '<': return left < right ? 1 : 0;
      case '>': return left > right ? 1 : 0;
      case '<=': return left <= right ? 1 : 0;
      case '>=': return left >= right ? 1 : 0;
      case '&&': return (left && right) ? 1 : 0;
      case '||': return (left || right) ? 1 : 0;
      default: return 0;
    }
  }

  /**
   * Run until completion (or fork).
   */
  run(): void {
    while (this.step()) {
      // Continue
    }
  }

  private executeStatement(stmt: ASTNode): void {
    switch (stmt.type) {
      case 'FunctionEntry':
        // Synthetic entry point - no-op, just marks entering main()
        break;
      case 'VarDecl':
        this.executeVarDecl(stmt);
        break;
      case 'Assignment':
        this.executeAssignment(stmt);
        break;
      case 'ExprStatement':
        this.evaluateExpr(stmt.expr);
        break;
      case 'PrintfCall':
        this.executePrintf(stmt);
        break;
      case 'ForkCall':
        this.executeFork(stmt);
        break;
      case 'WaitCall':
        this.executeWait(stmt, stmt.statusArg);
        break;
      case 'ExitCall':
        this.executeExit(stmt);
        break;
      case 'IfStatement':
        this.executeIf(stmt);
        break;
      case 'WhileStatement':
        this.executeWhile(stmt);
        break;
      case 'ForStatement':
        this.executeFor(stmt);
        break;
      case 'ReturnStatement':
        this.executeReturn(stmt);
        break;
      default:
        console.warn(`Unknown statement type: ${stmt.type}`);
    }
  }

  private executeVarDecl(stmt: ASTNode): void {
    const value = stmt.init ? this.evaluateExpr(stmt.init) : 0;
    this.state.variables.set(stmt.name, {
      name: stmt.name,
      type: stmt.varType,
      value: value,
    });
  }

  private executeAssignment(stmt: ASTNode): void {
    const value = this.evaluateExpr(stmt.value);
    const v = this.state.variables.get(stmt.name);
    if (v) {
      v.value = value;
    } else {
      // Implicit declaration (not strictly C, but convenient)
      this.state.variables.set(stmt.name, {
        name: stmt.name,
        type: 'int',
        value: value,
      });
    }
  }

  private executePrintf(stmt: ASTNode): void {
    let format = stmt.format.value as string;
    const args = stmt.args.map((a: ASTNode) => this.evaluateExpr(a));
    
    // Simple printf implementation
    let argIndex = 0;
    let output = format.replace(/%d|%i|%s|%c/g, (match) => {
      if (argIndex >= args.length) return match;
      const arg = args[argIndex++];
      switch (match) {
        case '%d':
        case '%i':
          return String(arg);
        case '%s':
          return String(arg);
        case '%c':
          return String.fromCharCode(arg as number);
        default:
          return match;
      }
    });
    
    this.state.output.push(output);
    if (this.onOutput) {
      this.onOutput(output);
    }
  }

  private executeFork(stmt: ASTNode): number {
    // Generate child PID
    const childPid = this.state.nextChildPid++;
    
    // Clone state for child process BEFORE modifying parent
    const childState = this.cloneState();
    
    // Child process: pid = 0 (from child's perspective)
    childState.pid = 0;
    // Child's parent is the current process
    childState.parentPid = this.state.pid;
    // Child inherits the same nextChildPid counter
    childState.nextChildPid = this.state.nextChildPid;
    
    // Check if there are remaining micro-ops after this fork in the current statement
    // (e.g., int pid = fork() has micro-ops: [fork, var_decl])
    const remainingOps = this.state.microOps.length - (this.state.microIndex + 1);
    
    if (remainingOps > 0) {
      // Child needs to finish the remaining micro-ops of this statement
      // Keep the same pc and micro-ops, but skip past the fork
      childState.microIndex = this.state.microIndex + 1;
      childState.valueStack = [0]; // fork() returns 0 for child
      // Update the child's currentRange to the next micro-op's range
      const nextOp = childState.microOps[childState.microIndex];
      if (nextOp?.range) {
        childState.currentRange = nextOp.range;
      }
    } else {
      // Fork was the last micro-op; child starts at next statement
      // Pre-load micro-ops so child shows the same position as parent
      childState.pc = this.state.pc + 1;
      childState.valueStack = [];
      if (childState.pc < this.statements.length) {
        const nextStmt = this.statements[childState.pc];
        const nextOps = this.generateMicroOps(nextStmt);
        childState.microOps = nextOps;
        childState.microIndex = 0;
        if (nextOps[0]?.range) {
          childState.currentRange = nextOps[0].range;
          childState.currentLine = nextStmt.line;
        }
      } else {
        childState.microOps = [];
        childState.microIndex = 0;
        childState.finished = true;
      }
    }
    
    // Emit fork event with cloned state
    if (this.onFork) {
      console.log(`CInterpreter: Emitting fork event, childPid=${childPid}, line=${stmt.line}, remainingOps=${remainingOps}`);
      this.onFork({
        childState: childState,
        childPid: childPid,
        forkLine: stmt.line,
      });
    } else {
      console.log(`CInterpreter: No onFork handler set!`);
    }
    
    // Parent process: returns child's PID
    return childPid;
  }

  private executeWait(stmt: ASTNode, statusArg: any): number {
    // Ask the App if any child has terminated
    if (this.onWait) {
      const result = this.onWait(this.state.pid);
      if (result) {
        // A child has terminated - store exit status if requested
        if (statusArg?.type === 'AddressArg') {
          const varName = statusArg.varName;
          const v = this.state.variables.get(varName);
          if (v) {
            v.value = result.exitStatus;
          } else {
            // Create the variable if it doesn't exist
            this.state.variables.set(varName, {
              name: varName,
              type: 'int',
              value: result.exitStatus,
            });
          }
        }
        // Return the terminated child's PID
        return result.childPid;
      }
    }
    // No children have terminated (or no callback set) - return -1
    return -1;
  }

  private executeExit(stmt: ASTNode): void {
    // Evaluate the exit code expression
    const exitCode = stmt.exitCode ? this.evaluateExpr(stmt.exitCode) : 0;
    
    // Set exit code and mark process as finished
    this.state.exitCode = exitCode;
    this.state.finished = true;
    
    // Clear remaining micro-ops to prevent further execution
    this.state.microIndex = this.state.microOps.length;
  }

  private executeIf(stmt: ASTNode): void {
    const condition = this.evaluateExpr(stmt.condition);
    
    if (condition) {
      // Execute 'then' branch - insert its statements after current position
      const thenStmts = this.flattenStatements(stmt.then);
      this.statements.splice(this.state.pc + 1, 0, ...thenStmts);
    } else if (stmt.else) {
      // Execute 'else' branch
      const elseStmts = this.flattenStatements(stmt.else);
      this.statements.splice(this.state.pc + 1, 0, ...elseStmts);
    }
  }

  private executeWhile(stmt: ASTNode): void {
    const condition = this.evaluateExpr(stmt.condition);
    
    if (condition) {
      // Insert loop body + this while statement again
      const bodyStmts = this.flattenStatements(stmt.body);
      this.statements.splice(this.state.pc + 1, 0, ...bodyStmts, stmt);
    }
  }

  private executeFor(stmt: ASTNode): void {
    // For loops are complex - convert to while loop semantics
    // First iteration: execute init
    if (stmt.init) {
      if (stmt.init.type === 'VarDecl') {
        this.executeVarDecl(stmt.init);
      } else {
        this.executeAssignment(stmt.init);
      }
    }
    
    // Check condition
    const condition = stmt.condition ? this.evaluateExpr(stmt.condition) : true;
    
    if (condition) {
      // Create synthetic statements for: body, update, condition check
      const bodyStmts = this.flattenStatements(stmt.body);
      
      // Create a synthetic "for continuation" node
      const forCont: ASTNode = {
        type: 'ForContinuation',
        line: stmt.line,
        condition: stmt.condition,
        update: stmt.update,
        body: stmt.body,
      };
      
      this.statements.splice(this.state.pc + 1, 0, ...bodyStmts, forCont);
    }
  }

  private executeReturn(stmt: ASTNode): void {
    this.state.exitCode = stmt.value ? (this.evaluateExpr(stmt.value) as number) : 0;
    this.state.finished = true;
  }

  private evaluateExpr(expr: ASTNode): number | string {
    switch (expr.type) {
      case 'NumberLiteral':
        return expr.value;
        
      case 'StringLiteral':
        return expr.value;
        
      case 'Variable':
        const v = this.state.variables.get(expr.name);
        return v ? v.value : 0;
        
      case 'ForkCall':
        return this.executeFork(expr);
        
      case 'WaitCall':
        return this.executeWait(expr, expr.statusArg);
        
      case 'BinaryExpr':
        return this.evaluateBinaryExpr(expr);
        
      case 'UnaryExpr':
        return this.evaluateUnaryExpr(expr);
        
      case 'TernaryExpr':
        return this.evaluateExpr(expr.condition) 
          ? this.evaluateExpr(expr.then) 
          : this.evaluateExpr(expr.else);
        
      case 'PreIncrement':
        const preIncVar = this.state.variables.get(expr.name);
        if (preIncVar) {
          preIncVar.value = (preIncVar.value as number) + 1;
          return preIncVar.value;
        }
        return 0;
        
      case 'PreDecrement':
        const preDecVar = this.state.variables.get(expr.name);
        if (preDecVar) {
          preDecVar.value = (preDecVar.value as number) - 1;
          return preDecVar.value;
        }
        return 0;
        
      case 'PostIncrement':
        const postIncVar = this.state.variables.get(expr.name);
        if (postIncVar) {
          const old = postIncVar.value;
          postIncVar.value = (postIncVar.value as number) + 1;
          return old;
        }
        return 0;
        
      case 'PostDecrement':
        const postDecVar = this.state.variables.get(expr.name);
        if (postDecVar) {
          const old = postDecVar.value;
          postDecVar.value = (postDecVar.value as number) - 1;
          return old;
        }
        return 0;
        
      default:
        console.warn(`Unknown expression type: ${expr.type}`);
        return 0;
    }
  }

  private evaluateBinaryExpr(expr: ASTNode): number {
    const left = this.evaluateExpr(expr.left) as number;
    const right = this.evaluateExpr(expr.right) as number;
    
    switch (expr.op) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': return right !== 0 ? Math.floor(left / right) : 0;
      case '%': return right !== 0 ? left % right : 0;
      case '==': return left === right ? 1 : 0;
      case '!=': return left !== right ? 1 : 0;
      case '<': return left < right ? 1 : 0;
      case '>': return left > right ? 1 : 0;
      case '<=': return left <= right ? 1 : 0;
      case '>=': return left >= right ? 1 : 0;
      case '&&': return left && right ? 1 : 0;
      case '||': return left || right ? 1 : 0;
      default: return 0;
    }
  }

  private evaluateUnaryExpr(expr: ASTNode): number {
    const val = this.evaluateExpr(expr.expr) as number;
    switch (expr.op) {
      case '!': return val ? 0 : 1;
      case '-': return -val;
      default: return val;
    }
  }

  // ============================================================================
  // Accessors
  // ============================================================================

  getVariables(): Variable[] {
    return Array.from(this.state.variables.values());
  }

  getOutput(): string {
    return this.state.output.join('');
  }

  getCurrentLine(): number {
    // Return the line we're ABOUT to execute (standard debugger behavior)
    // After step(), pc has advanced, so this returns the next line
    if (this.state.finished || this.state.pc >= this.statements.length) {
      return this.state.currentLine; // Use last executed line if finished
    }
    return this.statements[this.state.pc].line;
  }

  getCurrentRange(): SourceRange | null {
    // Return the range of the current micro-op for precise highlighting
    if (this.state.finished || this.state.pc >= this.statements.length) {
      return this.state.currentRange; // Use last range if finished
    }
    // If we have micro-ops, return the current micro-op's range
    if (this.state.microOps.length > 0 && this.state.microIndex < this.state.microOps.length) {
      return this.state.microOps[this.state.microIndex].range || this.state.currentRange;
    }
    return this.state.currentRange;
  }

  isFinished(): boolean {
    return this.state.finished;
  }

  getExitCode(): number {
    return this.state.exitCode;
  }

  getPid(): number {
    return this.state.pid;
  }

  getState(): InterpreterState {
    return this.cloneState();
  }

  setVariable(name: string, value: number | string): void {
    const v = this.state.variables.get(name);
    if (v) {
      v.value = value;
    } else {
      this.state.variables.set(name, {
        name,
        type: typeof value === 'number' ? 'int' : 'char*',
        value,
      });
    }
  }
}
