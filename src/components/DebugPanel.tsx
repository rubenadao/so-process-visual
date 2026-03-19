import React, { useState, useEffect, useRef } from 'react';
import { CPPDebugger } from '../lib/jscpp/debugger';
import AceEditor from './AceEditor';
import './DebugPanel.css';

interface DebugPanelProps {
  code: string;
  onRun?: () => void;
  onStepNext?: () => void;
  onStop?: () => void;
  isDebugging?: boolean;
  onLineChange?: (line: number) => void;
  onCodeChange?: (newCode: string) => void;
  onDebuggerCreated?: (debuggerInstance: any) => void;
  output?: string;
  input?: string;
  onInputChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  editorTheme?: string;
  initialEditorHeight?: number;
  onEditorHeightChange?: (height: number) => void;
}

const DebugPanel: React.FC<DebugPanelProps> = ({ 
  code, 
  onRun, 
  onStepNext, 
  onStop,
  isDebugging: externalIsDebugging,
  onLineChange,
  onCodeChange,
  onDebuggerCreated,
  output = '',
  input = '',
  onInputChange,
  editorTheme = 'monokai',
  initialEditorHeight = 250,
  onEditorHeightChange
}) => {
  const [localOutput, setLocalOutput] = useState<string>('');
  const [localInput, setLocalInput] = useState<string>('');
  const [isDebugging, setIsDebugging] = useState(false);
  const [currentLine, setCurrentLine] = useState(-1);
  const [editorHeight, setEditorHeight] = useState(initialEditorHeight);
  const debuggerRef = useRef<CPPDebugger | null>(null);
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // Handle editor vertical resize
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    isResizingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = editorHeight;
    document.addEventListener('mousemove', handleResizeMouseMove);
    document.addEventListener('mouseup', handleResizeMouseUp);
    e.preventDefault();
  };

  const handleResizeMouseMove = (e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const delta = e.clientY - startYRef.current;
    const newHeight = Math.max(100, Math.min(800, startHeightRef.current + delta));
    setEditorHeight(newHeight);
    onEditorHeightChange?.(newHeight);
  };

  const handleResizeMouseUp = () => {
    isResizingRef.current = false;
    document.removeEventListener('mousemove', handleResizeMouseMove);
    document.removeEventListener('mouseup', handleResizeMouseUp);
  };

  // Use external debugging state if provided
  const debuggingState = externalIsDebugging !== undefined ? externalIsDebugging : isDebugging;
  
  // Use external input/output if provided
  const displayOutput = output || localOutput;
  const displayInput = input || localInput;

  // Update local state and propagate line changes to parent
  const handleLineChange = (line: number) => {
    setCurrentLine(line);
    if (onLineChange) {
      onLineChange(line);
    }
  };

  const handleLocalInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalInput(e.target.value);
    if (onInputChange) {
      onInputChange(e);
    } else if (debuggerRef.current) {
      debuggerRef.current.setInput(e.target.value);
    }
  };

  const handleCodeChange = (newCode: string) => {
    if (onCodeChange) {
      onCodeChange(newCode);
    }
  };

  useEffect(() => {
    // Only create a local debugger if we're not using shared debuggers
    if (!onInputChange && !output) {
      debuggerRef.current = new CPPDebugger(setLocalOutput, handleLineChange);
      return () => {
        if (debuggerRef.current) {
          debuggerRef.current.stop();
        }
      };
    }
  }, []);

  const handleRun = async () => {
    if (onRun) {
      onRun();
      return;
    }
    
    // Only run locally if not using shared debugging
    if (!debuggerRef.current) return;
    
    debuggerRef.current.clearOutput();
    debuggerRef.current.setInput(localInput);
    setIsDebugging(true);
    
    try {
      await debuggerRef.current.startDebug(code);
      // Expose the entire CPPDebugger instance to the parent component,
      // not just the internal debugger property
      if (onDebuggerCreated) {
        // Pass the entire CPPDebugger instance
        onDebuggerCreated(debuggerRef.current);
      }
    } catch (error) {
      console.error('Failed to start debugging:', error);
      setIsDebugging(false);
    }
  };

  const handleStepNext = () => {
    if (onStepNext) {
      onStepNext();
      return;
    }
    
    // Only step locally if not using shared debugging
    if (!debuggerRef.current) return;
    
    try {
      debuggerRef.current.stepNext();
      if (!debuggerRef.current.isDebugging()) {
        setIsDebugging(false);
        if (onStop) onStop(); // Call onStop when debugging finishes
      }
    } catch (error) {
      console.error('Failed to step:', error);
      setIsDebugging(false);
      if (onStop) onStop(); // Call onStop on error
    }
  };

  const handleStop = () => {
    if (onStop) {
      onStop();
      return;
    }
    
    // Only stop locally if not using shared debugging
    if (debuggerRef.current) {
      debuggerRef.current.stop();
    }
    setIsDebugging(false);
    setCurrentLine(-1);
  };

  // Create a marker for the current line - now always empty to stop showing the line in the editor
  const markers = [];

  return (
    <div className="debug-panel">
      <div className="debug-controls">
        <button 
          className="btn-debug" 
          onClick={handleRun}
          disabled={debuggingState}
        >
          Run Program
        </button>
        <button 
          className="btn-debug" 
          onClick={handleStepNext}
          disabled={!debuggingState}
        >
          Step All
        </button>
        <button 
          className="btn-debug btn-stop" 
          onClick={handleStop}
          disabled={!debuggingState}
        >
          Stop
        </button>
      </div>
      
      <div className={`editor-container ${debuggingState ? 'debugging' : ''}`}>
        <AceEditor
          value={code}
          readOnly={debuggingState}
          markers={markers}
          mode="c_cpp"
          theme={editorTheme}
          name="debug-editor"
          width="100%"
          height={`${editorHeight}px`}
          fontSize={14}
          showPrintMargin={false}
          highlightActiveLine={true}
          onChange={handleCodeChange}
        />
        <div 
          className="editor-resize-handle"
          onMouseDown={handleResizeMouseDown}
          title="Drag to resize editor"
        />
      </div>
      
      <div className="io-container">
        <div className="input-area">
          <label>Program Input</label>
          <textarea
            value={displayInput}
            onChange={onInputChange || handleLocalInputChange}
            placeholder="Enter input values here (if your program requires stdin)..."
            disabled={debuggingState}
            spellCheck={false}
          />
        </div>
        
        <div className="output-area">
          <label>Program Output</label>
          <textarea
            value={displayOutput}
            readOnly
            placeholder="Program output will appear here when you run the code..."
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
};

export default DebugPanel; 