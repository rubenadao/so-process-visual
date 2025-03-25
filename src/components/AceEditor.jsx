import React, { useEffect, useRef } from 'react';
import './AceEditor.css';

const AceEditor = ({
    name = "brace-editor",
    mode = "javascript",
    theme = "monokai",
    value = "",
    markers = [],
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
}) => {
    const editorRef = useRef(null);
    const markerIds = useRef([]);

    useEffect(() => {
        if (!window.ace) {
            console.error("Ace editor not loaded!");
            return;
        }

        window.Range = ace.require("ace/range").Range;
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
        if (editorRef.current) {
            updateEditorProps();
        }
    }, [
        markers, mode, theme, fontSize, maxLines, readOnly, 
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

        // Add new markers
        if (markers && markers.length) {
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
};

export default AceEditor; 