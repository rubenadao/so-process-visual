import React, { useEffect, useRef } from 'react';
import './AceEditor.css';
import AceEditor from 'react-ace';

import "ace-builds/src-noconflict/mode-c_cpp";
import "ace-builds/src-noconflict/theme-monokai";
import "ace-builds/src-noconflict/theme-chrome";
import "ace-builds/src-noconflict/ext-language_tools";

const AceEditorWrapper = React.forwardRef(({
    name = "brace-editor",
    mode = "javascript",
    theme = "monokai",
    value = "",
    markers = [],
    highlightLine = -1,
    fontSize = 12,
    width = "100%",
    height = "100%",
    showGutter = true,
    onChange = null,
    onLoad = null,
    maxLines = null,
    readOnly = false,
    highlightActiveLine = true,
    showPrintMargin = true,
    setShowPrintMargin = true,
    className = ""
}, ref) => {
    const editorRef = useRef(null);
    const markerIds = useRef([]);

    useEffect(() => {
        console.log(`AceEditor ${name}: init useEffect, window.ace=${!!window.ace}`);
        if (!window.ace) {
            console.error("Ace editor not loaded!");
            return;
        }

        window.Range = ace.require("ace/range").Range;
        console.log(`AceEditor ${name}: creating editor for element id=${name}`);
        editorRef.current = ace.edit(name);
        editorRef.current.on("change", handleChange);
        updateEditorProps();

        if (onLoad) {
            onLoad(editorRef.current);
        }

        return () => {
            if (editorRef.current) {
                editorRef.current.destroy();
                editorRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        console.log(`AceEditor ${name}: highlightLine changed to ${highlightLine}, editorRef=${!!editorRef.current}`);
        if (editorRef.current) {
            updateEditorProps();
        }
    }, [
        markers, highlightLine, mode, theme, fontSize, maxLines, readOnly, 
        highlightActiveLine, setShowPrintMargin, value, showGutter
    ]);

    const updateEditorProps = () => {
        const editor = editorRef.current;

        editor.getSession().setMode("ace/mode/" + mode);
        editor.setTheme("ace/theme/" + theme);
        editor.setFontSize(fontSize);
        editor.setOption("maxLines", maxLines);
        editor.setOption("readOnly", readOnly);
        editor.setOption("highlightActiveLine", highlightActiveLine);
        editor.setOptions({
            showLineNumbers: true,
            enableBasicAutocompletion: true,
            enableSnippets: false,
            enableLiveAutocompletion: true
        });
        
        if (setShowPrintMargin !== undefined) {
            editor.setShowPrintMargin(setShowPrintMargin);
        }

        // Clear existing markers
        for (let markerid of markerIds.current) {
            editor.getSession().removeMarker(markerid);
        }
        markerIds.current = [];

        // Add new markers - prefer highlightLine if set
        const Range = ace.require("ace/range").Range;
        if (highlightLine >= 0 && Range) {
            const marker = new Range(highlightLine, 0, highlightLine, 1);
            const markerId = editor.getSession().addMarker(marker, "debug-highlight", "fullLine");
            markerIds.current.push(markerId);
            console.log(`AceEditor ${name}: added marker for line ${highlightLine}, markerId=${markerId}`);
        } else if (markers && markers.length) {
            for (let marker of markers) {
                markerIds.current.push(editor.getSession().addMarker(marker, "debug-highlight", "fullLine"));
            }
        }

        // Update value if changed
        if (editor.getValue() !== value) {
            editor.setValue(value, 1);
        }

        // Update gutter visibility
        editor.renderer.setShowGutter(showGutter);
    };

    const handleChange = () => {
        const value = editorRef.current.getValue();
        if (onChange) {
            onChange(value);
        }
    };

    return (
        <div id={name} className={className} style={{ width, height }}>
        </div>
    );
});

export default AceEditorWrapper; 