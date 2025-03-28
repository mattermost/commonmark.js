"use strict";

import Node from "./node.js";
import { unescapeString, OPENTAG, CLOSETAG, ESCAPABLE } from "./common.js";
import InlineParser from "./inlines.js";

var CODE_INDENT = 4;

var C_TAB = 9;
var C_NEWLINE = 10;
var C_GREATERTHAN = 62;
var C_LESSTHAN = 60;
var C_SPACE = 32;
var C_OPEN_BRACKET = 91;

var reHtmlBlockOpen = [
    /./, // dummy for 0
    /^<(?:script|pre|textarea|style)(?:\s|>|$)/i,
    /^<!--/,
    /^<[?]/,
    /^<![A-Za-z]/,
    /^<!\[CDATA\[/,
    /^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i,
    new RegExp("^(?:" + OPENTAG + "|" + CLOSETAG + ")\\s*$", "i")
];

var reHtmlBlockClose = [
    /./, // dummy for 0
    /<\/(?:script|pre|textarea|style)>/i,
    /-->/,
    /\?>/,
    />/,
    /\]\]>/
];

var reThematicBreak = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;

var reMaybeSpecial = /^[#`~*+_=<>0-9-|]/;

var reMaybeDelimiterRow = /[|\-]/;

var reNonSpace = /[^ \t\f\v\r\n]/;

var reBulletListMarker = /^[*+-]/;

var reOrderedListMarker = /^(\d{1,9})([.)])/;

var reATXHeadingMarker = /^#{1,6}(?:[ \t]+|$)/;

var reCodeFence = /^`{3,}(?!.*`)|^~{3,}/;

var reClosingCodeFence = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;

var reSetextHeadingLine = /^(?:=+|-+)[ \t]*$/;

var reLineEnding = /\r\n|\n|\r/;

var MAX_AUTOCOMPLETED_CELLS = 1000;

// Returns true if string contains only space characters.
var isBlank = function(s) {
    return !reNonSpace.test(s);
};

var isSpaceOrTab = function(c) {
    return c === C_SPACE || c === C_TAB;
};

var peek = function(ln, pos) {
    if (pos < ln.length) {
        return ln.charCodeAt(pos);
    } else {
        return -1;
    }
};

// DOC PARSER

// These are methods of a Parser object, defined below.

// Returns true if block ends with a blank line.
var endsWithBlankLine = function(block) {
    return block.next &&
        block.sourcepos[1][0] !== block.next.sourcepos[0][0] - 1;
};

// Add a line to the block at the tip.  We assume the tip
// can accept lines -- that check should be done before calling this.
var addLine = function() {
    if (this.partiallyConsumedTab) {
        this.offset += 1; // skip over tab
        // add space characters:
        var charsToTab = 4 - (this.column % 4);
        this.tip._string_content += " ".repeat(charsToTab);
    }
    this.tip._string_content += this.currentLine.slice(this.offset) + "\n";
};

// Change the tip to be of type tag as long as the parent can
// contain a block of that type.  Returns whether or not the
// type could be changed.
var changeTipType = function(tag) {
    const validChild = this.blocks[this.tip.parent.type].canContain(tag);
    if (validChild) {
        this.tip._type = tag;
    }

    return validChild;
};

// Add block of type tag as a child of the tip.  If the tip can't
// accept children, close and finalize it and try its parent,
// and so on til we find a block that can accept children.
var addChild = function(tag, offset) {
    while (!this.blocks[this.tip.type].canContain(tag)) {
        this.finalize(this.tip, this.lineNumber - 1);
    }

    var column_number = offset + 1; // offset 0 = column 1
    var newBlock = new Node(tag, [
        [this.lineNumber, column_number],
        [0, 0]
    ]);
    newBlock._string_content = "";
    this.tip.appendChild(newBlock);
    this.tip = newBlock;
    return newBlock;
};

// Parse a list marker and return data on the marker (type,
// start, delimiter, bullet character, padding) or null.
var parseListMarker = function(parser, container) {
    var rest = parser.currentLine.slice(parser.nextNonspace);
    var match;
    var nextc;
    var spacesStartCol;
    var spacesStartOffset;
    var data = {
        type: null,
        tight: true, // lists are tight by default
        bulletChar: null,
        start: null,
        delimiter: null,
        padding: null,
        markerOffset: parser.indent
    };
    if (parser.indent >= 4) {
        return null;
    }
    if ((match = rest.match(reBulletListMarker))) {
        data.type = "bullet";
        data.bulletChar = match[0][0];
    } else if (
        (match = rest.match(reOrderedListMarker)) &&
        (container.type !== "paragraph" || match[1] == 1)
    ) {
        data.type = "ordered";
        data.start = parseInt(match[1]);
        data.delimiter = match[2];
    } else {
        return null;
    }
    // make sure we have spaces after
    nextc = peek(parser.currentLine, parser.nextNonspace + match[0].length);
    if (!(nextc === -1 || nextc === C_TAB || nextc === C_SPACE)) {
        return null;
    }

    // if it interrupts paragraph, make sure first line isn't blank
    if (
        container.type === "paragraph" &&
        !parser.currentLine
            .slice(parser.nextNonspace + match[0].length)
            .match(reNonSpace)
    ) {
        return null;
    }

    // we've got a match! advance offset and calculate padding
    parser.advanceNextNonspace(); // to start of marker
    parser.advanceOffset(match[0].length, true); // to end of marker
    spacesStartCol = parser.column;
    spacesStartOffset = parser.offset;
    do {
        parser.advanceOffset(1, true);
        nextc = peek(parser.currentLine, parser.offset);
    } while (parser.column - spacesStartCol < 5 && isSpaceOrTab(nextc));
    var blank_item = peek(parser.currentLine, parser.offset) === -1;
    var spaces_after_marker = parser.column - spacesStartCol;
    if (spaces_after_marker >= 5 || spaces_after_marker < 1 || blank_item) {
        data.padding = match[0].length + 1;
        parser.column = spacesStartCol;
        parser.offset = spacesStartOffset;
        if (isSpaceOrTab(peek(parser.currentLine, parser.offset))) {
            parser.advanceOffset(1, true);
        }
    } else {
        data.padding = match[0].length + spaces_after_marker;
    }
    return data;
};

// Returns true if the two list items are of the same type,
// with the same delimiter and bullet character.  This is used
// in agglomerating list items into lists.
var listsMatch = function(list_data, item_data) {
    return (
        list_data.type === item_data.type &&
        list_data.delimiter === item_data.delimiter &&
        list_data.bulletChar === item_data.bulletChar
    );
};

// Finalize and close any unmatched blocks.
var closeUnmatchedBlocks = function() {
    if (!this.allClosed) {
        // finalize any blocks not matched
        while (this.oldtip !== this.lastMatchedContainer) {
            var parent = this.oldtip._parent;
            this.finalize(this.oldtip, this.lineNumber - 1);
            this.oldtip = parent;
        }
        this.allClosed = true;
    }
};

// Remove link reference definitions from given tree.
var removeLinkReferenceDefinitions = function(parser, tree) {
    var event, node;
    var walker = tree.walker();
    var emptyNodes = [];

    while ((event = walker.next())) {
        node = event.node;
        if (event.entering && node.type === "paragraph") {
            var pos;
            var hasReferenceDefs = false;

            // Try parsing the beginning as link reference definitions;
            // Note that link reference definitions must be the beginning of a
            // paragraph node since link reference definitions cannot interrupt
            // paragraphs.
            while (
                peek(node._string_content, 0) === C_OPEN_BRACKET &&
                    (pos = parser.inlineParser.parseReference(
                        node._string_content,
                        parser.refmap
                    ))
            ) {
                const removedText = node._string_content.slice(0, pos);

                node._string_content = node._string_content.slice(pos);
                hasReferenceDefs = true;

                const lines = removedText.split("\n");

                // -1 for final newline.
                node.sourcepos[0][0] += lines.length - 1;
            }
            if (hasReferenceDefs && isBlank(node._string_content)) {
                emptyNodes.push(node);
            }
        }
    }

    for (node of emptyNodes) {
        node.unlink();
    }
};

// 'finalize' is run when the block is closed.
// 'continue' is run to check whether the block is continuing
// at a certain line and offset (e.g. whether a block quote
// contains a `>`.  It returns 0 for matched, 1 for not matched,
// and 2 for "we've dealt with this line completely, go to next."
var blocks = {
    document: {
        continue: function() {
            return 0;
        },
        finalize: function(parser, block) {
            removeLinkReferenceDefinitions(parser, block);
            return;
        },
        canContain: function(t) {
            return t !== "item";
        },
        acceptsLines: false
    },
    list: {
        continue: function() {
            return 0;
        },
        finalize: function(parser, block) {
            var item = block._firstChild;
            while (item) {
                // check for non-final list item ending with blank line:
                if (item._next && endsWithBlankLine(item)) {
                    block._listData.tight = false;
                    break;
                }
                // recurse into children of list item, to see if there are
                // spaces between any of them:
                var subitem = item._firstChild;
                while (subitem) {
                    if (
                        subitem._next &&
                        endsWithBlankLine(subitem)
                    ) {
                        block._listData.tight = false;
                        break;
                    }
                    subitem = subitem._next;
                }
                item = item._next;
            }
            block.sourcepos[1] = block._lastChild.sourcepos[1];
        },
        canContain: function(t) {
            return t === "item";
        },
        acceptsLines: false
    },
    block_quote: {
        continue: function(parser) {
            var ln = parser.currentLine;
            if (
                !parser.indented &&
                peek(ln, parser.nextNonspace) === C_GREATERTHAN
            ) {
                parser.advanceNextNonspace();
                parser.advanceOffset(1, false);
                if (isSpaceOrTab(peek(ln, parser.offset))) {
                    parser.advanceOffset(1, true);
                }
            } else {
                return 1;
            }
            return 0;
        },
        finalize: function() {
            return;
        },
        canContain: function(t) {
            return t !== "item";
        },
        acceptsLines: false
    },
    item: {
        continue: function(parser, container) {
            if (parser.blank) {
                if (container._firstChild == null) {
                    // Blank line after empty list item
                    return 1;
                } else {
                    parser.advanceNextNonspace();
                }
            } else if (
                parser.indent >=
                container._listData.markerOffset + container._listData.padding
            ) {
                parser.advanceOffset(
                    container._listData.markerOffset +
                        container._listData.padding,
                    true
                );
            } else {
                return 1;
            }
            return 0;
        },
        finalize: function(parser, block) {
            if (block._lastChild) {
                block.sourcepos[1] = block._lastChild.sourcepos[1];
            } else {
                // Empty list item
                block.sourcepos[1][0] = block.sourcepos[0][0];
                block.sourcepos[1][1] =
                    block._listData.markerOffset + block._listData.padding;
            }

            return;
        },
        canContain: function(t) {
            return t !== "item";
        },
        acceptsLines: false
    },
    heading: {
        continue: function() {
            // a heading can never container > 1 line, so fail to match:
            return 1;
        },
        finalize: function() {
            return;
        },
        canContain: function() {
            return false;
        },
        acceptsLines: false
    },
    thematic_break: {
        continue: function() {
            // a thematic break can never container > 1 line, so fail to match:
            return 1;
        },
        finalize: function() {
            return;
        },
        canContain: function() {
            return false;
        },
        acceptsLines: false
    },
    code_block: {
        continue: function(parser, container) {
            var ln = parser.currentLine;
            var indent = parser.indent;
            if (container._isFenced) {
                // fenced
                var match =
                    indent <= 3 &&
                    ln.charAt(parser.nextNonspace) === container._fenceChar &&
                    ln.slice(parser.nextNonspace).match(reClosingCodeFence);
                if (match && match[0].length >= container._fenceLength) {
                    // closing fence - we're at end of line, so we can return
                    parser.lastLineLength =
                        parser.offset + indent + match[0].length;
                    parser.finalize(container, parser.lineNumber);
                    return 2;
                } else {
                    // skip optional spaces of fence offset
                    var i = container._fenceOffset;
                    while (i > 0 && isSpaceOrTab(peek(ln, parser.offset))) {
                        parser.advanceOffset(1, true);
                        i--;
                    }
                }
            } else {
                // indented
                if (indent >= CODE_INDENT) {
                    parser.advanceOffset(CODE_INDENT, true);
                } else if (parser.blank) {
                    parser.advanceNextNonspace();
                } else {
                    return 1;
                }
            }
            return 0;
        },
        finalize: function(parser, block) {
            if (block._isFenced) {
                // fenced
                // first line becomes info string
                var content = block._string_content;
                var newlinePos = content.indexOf("\n");
                var firstLine = content.slice(0, newlinePos);
                var rest = content.slice(newlinePos + 1);
                block.info = unescapeString(firstLine.trim());
                block._literal = rest;
            } else {
                // indented
                var lines = block._string_content.split("\n");
                // Note that indented code block cannot be empty, so
                // lines.length cannot be zero.
                while (/^[ \t]*$/.test(lines[lines.length - 1])) {
                    lines.pop();
                }
                block._literal = lines.join("\n") + "\n";
                block.sourcepos[1][0] =
                    block.sourcepos[0][0] + lines.length - 1;
                block.sourcepos[1][1] =
                    block.sourcepos[0][1] + lines[lines.length - 1].length - 1;
            }
            block._string_content = null; // allow GC
        },
        canContain: function() {
            return false;
        },
        acceptsLines: true
    },
    html_block: {
        continue: function(parser, container) {
            return parser.blank &&
                (container._htmlBlockType === 6 ||
                    container._htmlBlockType === 7)
                ? 1
                : 0;
        },
        finalize: function(parser, block) {
            block._literal = block._string_content.replace(/\n$/, '');
            block._string_content = null; // allow GC
        },
        canContain: function() {
            return false;
        },
        acceptsLines: true
    },
    table: {
        continue: function(parser) {
            if (parser.blank) {
                // next line is blank so the table has ended
                return 1;
            } else if (parser.indented) {
                // next line is indented so its part of a list or code block
                return 1;
            }

            return 0;
        },
        finalize: function(parser, block) {
            var numberOfColumns = block.alignColumns.length;

            var numberOfAutocompletedCells = 0;

            for (var row = block.firstChild; row; row = row.next) {
                var i = 0;
                for (var cell = row.firstChild; cell; cell = cell.next) {
                    i += 1;

                    // if there's more columns in a row than the header row, GitHub cuts them off
                    if (i + 1 > numberOfColumns) {
                        cell._next = null;
                        row._lastChild = cell;
                        break;
                    }
                }

                // GitHub adds extra empty cells to make sure all rows are equal width
                while (i < numberOfColumns) {
                    numberOfAutocompletedCells += 1;
                    if (numberOfAutocompletedCells > MAX_AUTOCOMPLETED_CELLS) {
                        break;
                    }

                    var cell = new Node("table_cell");

                    cell._string_content = "";
                    cell.isHeading = row.isHeading;
                    cell.align = block.alignColumns[i];

                    row.appendChild(cell);
                    i += 1;
                }
            }
        },
        canContain: function(t) { return (t === "table_row"); },
        acceptsLines: false
    },
    table_row: {
        continue: function(parser) {
            if (parser.blank) {
                return 2;
            }

            return 1;
        },
        finalize: function() {
            return;
        },
        canContain: function(t) { return (t === "table_cell"); },
        acceptsLines: false
    },
    table_cell: {
        continue: function() {
            return 1;
        },
        finalize: function() {
            return;
        },
        canContain: function() { return false; },
        acceptsLines: false
    },
    paragraph: {
        continue: function(parser) {
            return parser.blank ? 1 : 0;
        },
        finalize: function() {
            return;
        },
        canContain: function() {
            return false;
        },
        acceptsLines: true
    }
};

// block start functions.  Return values:
// 0 = no match
// 1 = matched container, keep going
// 2 = matched leaf, no more block starts
var blockStarts = [
    // block quote
    function(parser) {
        if (
            !parser.indented &&
            peek(parser.currentLine, parser.nextNonspace) === C_GREATERTHAN
        ) {
            parser.advanceNextNonspace();
            parser.advanceOffset(1, false);
            // optional following space
            if (isSpaceOrTab(peek(parser.currentLine, parser.offset))) {
                parser.advanceOffset(1, true);
            }
            parser.closeUnmatchedBlocks();
            parser.addChild("block_quote", parser.nextNonspace);
            return 1;
        } else {
            return 0;
        }
    },

    // ATX heading
    function(parser) {
        var match;
        if (
            !parser.indented &&
            (match = parser.currentLine
                .slice(parser.nextNonspace)
                .match(reATXHeadingMarker))
        ) {
            parser.advanceNextNonspace();
            parser.advanceOffset(match[0].length, false);
            parser.closeUnmatchedBlocks();
            var container = parser.addChild("heading", parser.nextNonspace);
            container.level = match[0].trim().length; // number of #s
            // remove trailing ###s:
            container._string_content = parser.currentLine
                .slice(parser.offset)
                .replace(/^[ \t]*#+[ \t]*$/, "")
                .replace(/[ \t]+#+[ \t]*$/, "");
            parser.advanceOffset(parser.currentLine.length - parser.offset);
            return 2;
        } else {
            return 0;
        }
    },

    // Fenced code block
    function(parser) {
        var match;
        if (
            !parser.indented &&
            (match = parser.currentLine
                .slice(parser.nextNonspace)
                .match(reCodeFence))
        ) {
            var fenceLength = match[0].length;
            parser.closeUnmatchedBlocks();
            var container = parser.addChild("code_block", parser.nextNonspace);
            container._isFenced = true;
            container._fenceLength = fenceLength;
            container._fenceChar = match[0][0];
            container._fenceOffset = parser.indent;
            parser.advanceNextNonspace();
            parser.advanceOffset(fenceLength, false);
            return 2;
        } else {
            return 0;
        }
    },

    // HTML block
    function(parser, container) {
        if (
            !parser.indented &&
            peek(parser.currentLine, parser.nextNonspace) === C_LESSTHAN
        ) {
            var s = parser.currentLine.slice(parser.nextNonspace);
            var blockType;

            for (blockType = 1; blockType <= 7; blockType++) {
                if (
                    reHtmlBlockOpen[blockType].test(s) &&
                    (blockType < 7 || (container.type !== "paragraph" &&
                     !(!parser.allClosed && !parser.blank &&
                       parser.tip.type === "paragraph") // maybe lazy
                    ))
                ) {
                    parser.closeUnmatchedBlocks();
                    // We don't adjust parser.offset;
                    // spaces are part of the HTML block:
                    var b = parser.addChild("html_block", parser.offset);
                    b._htmlBlockType = blockType;
                    return 2;
                }
            }
        }

        return 0;
    },

    // Setext heading
    function(parser, container) {
        var match;
        if (
            !parser.indented &&
            container.type === "paragraph" &&
            (match = parser.currentLine
                .slice(parser.nextNonspace)
                .match(reSetextHeadingLine))
        ) {
            parser.closeUnmatchedBlocks();
            // resolve reference link definitiosn
            var pos;
            while (
                peek(container._string_content, 0) === C_OPEN_BRACKET &&
                (pos = parser.inlineParser.parseReference(
                    container._string_content,
                    parser.refmap
                ))
            ) {
                container._string_content = container._string_content.slice(
                    pos
                );
            }
            if (container._string_content.length > 0) {
                var heading = new Node("heading", container.sourcepos);
                heading.level = match[0][0] === "=" ? 1 : 2;
                heading._string_content = container._string_content;
                container.insertAfter(heading);
                container.unlink();
                parser.tip = heading;
                parser.advanceOffset(
                    parser.currentLine.length - parser.offset,
                    false
                );
                return 2;
            } else {
                return 0;
            }
        } else {
            return 0;
        }
    },

    // thematic break
    function(parser) {
        if (
            !parser.indented &&
            reThematicBreak.test(parser.currentLine.slice(parser.nextNonspace))
        ) {
            parser.closeUnmatchedBlocks();
            parser.addChild("thematic_break", parser.nextNonspace);
            parser.advanceOffset(
                parser.currentLine.length - parser.offset,
                false
            );
            return 2;
        } else {
            return 0;
        }
    },

    // list item
    function(parser, container) {
        var data;

        if (
            (!parser.indented || container.type === "list") &&
            (data = parseListMarker(parser, container))
        ) {
            parser.closeUnmatchedBlocks();

            // add the list if needed
            if (
                parser.tip.type !== "list" ||
                !listsMatch(container._listData, data)
            ) {
                container = parser.addChild("list", parser.nextNonspace);
                container._listData = data;
            }

            // add the list item
            container = parser.addChild("item", parser.nextNonspace);
            container._listData = data;
            return 1;
        } else {
            return 0;
        }
    },

    // indented code block
    function(parser) {
        if (
            parser.indented &&
            parser.tip.type !== "paragraph" &&
            !parser.blank
        ) {
            // indented code
            parser.advanceOffset(CODE_INDENT, true);
            parser.closeUnmatchedBlocks();
            parser.addChild("code_block", parser.offset);
            return 2;
        } else {
            return 0;
        }
    },

    // table
    function(parser, container) {
        // Because tables depend on two adjacent lines, the first line is read into a paragraph and then we might turn
        // that paragraph into a table when we read the second line.

        if (parser.indented || container.type !== "paragraph") {
            return 0;
        }

        if (container._tableVisited) {
            return 0;
        }

        // At this point, we're on the second line of the paragraph, so we can check to see the two lines we've read
        // are the header row and delimiter row of the table

        // Check for a delimiter first since it's stricter than the header row.
        const delimiterCells = parseTableRow(parser.currentLine, parser.nextNonspace);
        if (!delimiterCells || !validateDelimiterRow(delimiterCells)) {
            // The second line of the paragraph isn't a table row, so this paragraph isn't actually a table
            return 0;
        }

        // container._string_content contains everything in the paragraph so far including a trailing newline, but
        // we only want to check the last line of it for the header row
        const lastLineMatch = matchLastLine(container._string_content);
        const lastLine = lastLineMatch[1];

        const headerCells = parseTableRow(lastLine, 0);
        if (!headerCells) {
            // The first line isn't a header row, so this isn't a table
            return 0;
        }

        if (delimiterCells.length !== headerCells.length) {
            // The first two rows must be the same length for this to be considered a table

            // Track that we've already identified that this paragraph isn't a table, so that we don't check the same
            // paragraph again
            container._tableVisited = true;
            return 0;
        }

        // Turn this paragraph into a table if possible
        if (!parser.changeTipType("table")) {
            return 0;
        }

        // If there's any text before lastLine, then there's text before the table that we need to re-add as a
        // paragraph before the table
        if (lastLineMatch.index > 0) {
            // Create the new paragraph node based on where we found the header row
            const textBeforeTable = parser.tip._string_content.substring(0, lastLineMatch.index);
            const lastLineBeforeTable = matchLastLine(textBeforeTable);

            const newParagraph = new Node("paragraph", [
                parser.tip.sourcepos[0],
                [parser.lineNumber - 2, lastLineBeforeTable.length],
            ]);
            newParagraph._string_content = textBeforeTable;

            // Update the parser.tip which is now the table with its new position
            parser.tip._string_content = parser.tip._string_content.substring(lastLineMatch.index);
            parser.tip._sourcepos[0] = [parser.lineNumber - 1, 0];

            // Add the paragraph before the table
            parser.tip.insertBefore(newParagraph);
        }

        // Store the alignments of the columns and then skip the delimiter line since we've
        // gotten what we need from it
        parser.tip.alignColumns = delimiterCells.map(getCellAlignment);

        const headerRow = new Node("table_row", [
            [parser.lineNumber - 1, parser.offset + 1],
            [parser.lineNumber - 1, parser.offset + lastLine.length],
        ]);
        headerRow._string_content = container._string_content.substring(0, lastLine.length);
        headerRow._isHeading = true;

        for (let i = 0; i < headerCells.length; i++) {
            const cell = new Node("table_cell", [
                [parser.lineNumber - 1, headerCells[i].start],
                [parser.lineNumber - 1, headerCells[i].end],
            ]);

            cell._string_content = headerCells[i].contents;
            cell._align = parser.tip.alignColumns[i];
            cell._isHeading = true;

            headerRow.appendChild(cell);
        }

        parser.tip.appendChild(headerRow);

        // Mark the rest of the line as read
        parser.advanceOffset(
            parser.currentLine.length - parser.offset,
            false
        );

        return 1;
    },

    // table_row
    function(parser, container) {
        if (container.type !== "table") {
            return 0;
        }

        if (parser.blank) {
            return 2;
        }

        const cells = parseTableRow(parser.currentLine, parser.nextNonspace);
        if (!cells) {
            return 0;
        }

        parser.closeUnmatchedBlocks();
        parser.addChild("table_row", parser.nextNonspace);

        for (let i = 0; i < cells.length; i++) {
            const cell = new Node("table_cell", [
                [parser.lineNumber, cells[i].start],
                [parser.lineNumber, cells[i].end],
            ]);

            cell._string_content = cells[i].contents;
            cell._align = parser.tip.parent.alignColumns[i];

            parser.tip.appendChild(cell);
        }

        // Mark the rest of the line as read
        parser.advanceOffset(
            parser.currentLine.length - parser.offset,
            false
        );

        return 2;
    }
];

const parseTableRow = function(line, startAt) {
    // This is attempting to replicate row_from_string from GitHub's Commonmark fork. That function can be found here:
    // https://github.com/github/cmark-gfm/blob/587a12bb54d95ac37241377e6ddc93ea0e45439b/extensions/table.c#L189

    let cells = [];

    let expectMoreCells = true;

    // Start at the current parser position
    let offset = startAt;

    // Read past the optional leading pipe
    offset += scanTableCellEnd(line, offset);

    while (offset < line.length && expectMoreCells) {
        const cellLength = scanTableCell(line, offset);
        const pipeLength = scanTableCellEnd(line, offset + cellLength);

        if (cellLength > 0 || pipeLength > 0) {
            // We're guaranteed to have found a cell because we either found some cell content (cellLength > 0) or
            // we found an empty cell with a pipe (cellLength == 0 && pipeLength > 0)
            const cellContents = unescapePipes(line.substring(offset, offset + cellLength));

            cells.push({
                contents: cellContents,
                start: offset,
                end: offset + cellLength,
            });

            offset += cellLength + pipeLength;
        }

        if (pipeLength > 0) {
            expectMoreCells = true;
        } else {
            // We've read the last cell, so check if we've reached the end of the row
            const rowEndLength = scanTableRowEnd(line, offset);

            // Unlike cmark-gfm, we don't need to try again on the next line because we only call this function with
            // one line at a time

            if (rowEndLength === -1) {
                // There's more text after this, so this isn't a table row
            } else {
                offset += rowEndLength;
            }

            expectMoreCells = false;
        }
    }

    if (offset === line.length) {
        // We've read the whole line, so it's a valid row
        return cells;
    } else {
        // There's unhandled text here, so it's not actually a table row
        return null;
    }
};

const reTableCell = new RegExp("^([\\\\]" + ESCAPABLE + "|[^|\r\n])+");
const scanTableCell = function(line, offset) {
    // Reads up until a newline or an unescaped pipe and return the number of characters read
    const match = reTableCell.exec(line.substring(offset));
    if (match) {
        return match[0].length;
    } else {
        // If this doesn't match, it may still be valid because there's an empty table cell or we're at the end of the line
        return 0;
    }
};

const scanTableCellEnd = function(line, offset) {
    // Read an optional pipe followed by some amount of optional whitespace and return the number of characters read
    let i = 0;

    if (line.charAt(offset + i) === "|") {
        i += 1;
    }

    let c = line.charAt(offset + i);
    while (c === " " || c === "\t" || c === "\v" || c === "\f") {
        i += 1;
        c = line.charAt(offset + i);
    }

    return i;
};

const scanTableRowEnd = function(line, offset) {
    // Read any amount of optional whitespace and then ensure that we're at the end of the string
    let i = 0;

    let c = line.charAt(offset + i);
    while (c === " " || c === "\t" || c === "\v" || c === "\f") {
        i += 1;
        c = line.charAt(offset + i);
    }

    if (offset + i === line.length) {
        // This is the end of the row
        return i;
    } else {
        // There's still more after this which means this isn't actually a table row
        return -1;
    }
};

const reValidTableDelimiter = /^[ \t]*:?-+:?[ \t]*$/;
const validateDelimiterRow = function(cells) {
    for (const cell of cells) {
        if (!reValidTableDelimiter.test(cell.contents)) {
            return false;
        }
    }

    return true;
};

const unescapePipes = function(str) {
    return str.replace("\\|", "|");
};

const matchLastLine = function(str) {
    return (/([^\n]*)\n$/).exec(str);
};

var getCellAlignment = function(cell) {
    const cellContents = cell.contents.trim();

    if (cellContents.charAt(0) === ":") {
        if (cellContents.charAt(cellContents.length - 1) === ":") {
            return "center";
        } else {
            return "left";
        }
    } else if (cellContents.endsWith(":")) {
        return "right";
    } else {
        return "";
    }
};

var advanceOffset = function(count, columns) {
    var currentLine = this.currentLine;
    var charsToTab, charsToAdvance;
    var c;
    while (count > 0 && (c = currentLine[this.offset])) {
        if (c === "\t") {
            charsToTab = 4 - (this.column % 4);
            if (columns) {
                this.partiallyConsumedTab = charsToTab > count;
                charsToAdvance = charsToTab > count ? count : charsToTab;
                this.column += charsToAdvance;
                this.offset += this.partiallyConsumedTab ? 0 : 1;
                count -= charsToAdvance;
            } else {
                this.partiallyConsumedTab = false;
                this.column += charsToTab;
                this.offset += 1;
                count -= 1;
            }
        } else {
            this.partiallyConsumedTab = false;
            this.offset += 1;
            this.column += 1; // assume ascii; block starts are ascii
            count -= 1;
        }
    }
};

var advanceNextNonspace = function() {
    this.offset = this.nextNonspace;
    this.column = this.nextNonspaceColumn;
    this.partiallyConsumedTab = false;
};

var findNextNonspace = function() {
    var currentLine = this.currentLine;
    var i = this.offset;
    var cols = this.column;
    var c;

    while ((c = currentLine.charAt(i)) !== "") {
        if (c === " ") {
            i++;
            cols++;
        } else if (c === "\t") {
            i++;
            cols += 4 - (cols % 4);
        } else {
            break;
        }
    }
    this.blank = c === "\n" || c === "\r" || c === "";
    this.nextNonspace = i;
    this.nextNonspaceColumn = cols;
    this.indent = this.nextNonspaceColumn - this.column;
    this.indented = this.indent >= CODE_INDENT;
};

// Analyze a line of text and update the document appropriately.
// We parse markdown text by calling this on each line of input,
// then finalizing the document.
var incorporateLine = function(ln) {
    var all_matched = true;
    var t;

    var container = this.doc;
    this.oldtip = this.tip;
    this.offset = 0;
    this.column = 0;
    this.blank = false;
    this.partiallyConsumedTab = false;
    this.lineNumber += 1;

    // replace NUL characters for security
    if (ln.indexOf("\u0000") !== -1) {
        ln = ln.replace(/\0/g, "\uFFFD");
    }

    this.currentLine = ln;

    // For each containing block, try to parse the associated line start.
    // Bail out on failure: container will point to the last matching block.
    // Set all_matched to false if not all containers match.
    var lastChild;
    while ((lastChild = container._lastChild) && lastChild._open) {
        container = lastChild;

        this.findNextNonspace();

        switch (this.blocks[container.type].continue(this, container)) {
            case 0: // we've matched, keep going
                break;
            case 1: // we've failed to match a block
                all_matched = false;
                break;
            case 2: // we've hit end of line for fenced code close and can return
                return;
            default:
                throw "continue returned illegal value, must be 0, 1, or 2";
        }
        if (!all_matched) {
            container = container._parent; // back up to last matching block
            break;
        }
    }

    this.allClosed = container === this.oldtip;
    this.lastMatchedContainer = container;

    var matchedLeaf =
        container.type !== "paragraph" && blocks[container.type].acceptsLines;
    var starts = this.blockStarts;
    var startsLen = starts.length;
    // Unless last matched container is a code block, try new container starts,
    // adding children to the last matched container:
    while (!matchedLeaf) {
        this.findNextNonspace();

        // this is a little performance optimization:
        if (
            !this.indented && // starts indented code blocks
            !reMaybeSpecial.test(ln.slice(this.nextNonspace)) && // starts lists, block quotes, etc
            (container.type !== "table" && container.type !== "table_row") && // start table rows
            !reMaybeDelimiterRow.test(ln.slice(this.nextNonspace)) // starts tables
        ) {
            this.advanceNextNonspace();
            break;
        }

        var i = 0;
        while (i < startsLen) {
            var res = starts[i](this, container);
            if (res === 1) {
                container = this.tip;
                break;
            } else if (res === 2) {
                container = this.tip;
                matchedLeaf = true;
                break;
            } else {
                i++;
            }
        }

        if (i === startsLen) {
            // nothing matched
            this.advanceNextNonspace();
            break;
        }
    }

    // What remains at the offset is a text line.  Add the text to the
    // appropriate container.

    // First check for a lazy paragraph continuation:
    if (
        !this.allClosed && !this.blank &&
        this.tip.type === "paragraph" &&
        !(this.tip._parent.type === "item" && this.indent === 0)
    ) {
        // lazy paragraph continuation
        this.addLine();
    } else {
        // not a lazy continuation

        // finalize any blocks not matched
        this.closeUnmatchedBlocks();

        t = container.type;

        if (this.blocks[t].acceptsLines) {
            this.addLine();
            // if HtmlBlock, check for end condition
            if (
                t === "html_block" &&
                container._htmlBlockType >= 1 &&
                container._htmlBlockType <= 5 &&
                reHtmlBlockClose[container._htmlBlockType].test(
                    this.currentLine.slice(this.offset)
                )
            ) {
                this.lastLineLength = ln.length;
                this.finalize(container, this.lineNumber);
            }
        } else if (this.offset < ln.length && !this.blank) {
            // create paragraph container for line
            container = this.addChild("paragraph", this.offset);
            this.advanceNextNonspace();
            this.addLine();
        }
    }
    this.lastLineLength = ln.length;
};

// Finalize a block.  Close it and do any necessary postprocessing,
// e.g. creating string_content from strings, setting the 'tight'
// or 'loose' status of a list, and parsing the beginnings
// of paragraphs for reference definitions.  Reset the tip to the
// parent of the closed block.
var finalize = function(block, lineNumber) {
    var above = block._parent;
    block._open = false;
    block.sourcepos[1] = [lineNumber, this.lastLineLength];

    this.blocks[block.type].finalize(this, block);

    this.tip = above;
};

// Walk through a block & children recursively, parsing string content
// into inline content where appropriate.
var processInlines = function(block) {
    var node, event, t;
    var walker = block.walker();
    this.inlineParser.refmap = this.refmap;
    this.inlineParser.options = this.options;
    while ((event = walker.next())) {
        node = event.node;
        t = node.type;
        if (!event.entering && (t === "paragraph" || t === "heading" || t === "table_cell")) {
            this.inlineParser.parse(node);
        }
    }
};

var Document = function() {
    var doc = new Node("document", [
        [1, 1],
        [0, 0]
    ]);
    return doc;
};

// The main parsing function.  Returns a parsed document AST.
var parse = function(input) {
    this.doc = new Document();
    this.tip = this.doc;
    this.refmap = {};
    this.lineNumber = 0;
    this.lastLineLength = 0;
    this.offset = 0;
    this.column = 0;
    this.lastMatchedContainer = this.doc;
    this.currentLine = "";
    if (this.options.time) {
        console.time("preparing input");
    }
    var lines = input.split(reLineEnding);
    var len = lines.length;
    if (input.charCodeAt(input.length - 1) === C_NEWLINE) {
        // ignore last blank line created by final newline
        len -= 1;
    }
    if (this.options.time) {
        console.timeEnd("preparing input");
    }
    if (this.options.time) {
        console.time("block parsing");
    }
    for (var i = 0; i < len; i++) {
        this.incorporateLine(lines[i]);
    }
    while (this.tip) {
        this.finalize(this.tip, len);
    }
    if (this.options.time) {
        console.timeEnd("block parsing");
    }
    if (this.options.time) {
        console.time("inline parsing");
    }
    this.processInlines(this.doc);
    if (this.options.time) {
        console.timeEnd("inline parsing");
    }
    return this.doc;
};

// The Parser object.
function Parser(options) {
    options = options || {};

    if (options.minimumHashtagLength == null) {
        options.minimumHashtagLength = 3;
    }

    return {
        doc: new Document(),
        blocks: blocks,
        blockStarts: blockStarts,
        tip: this.doc,
        oldtip: this.doc,
        currentLine: "",
        lineNumber: 0,
        offset: 0,
        column: 0,
        nextNonspace: 0,
        nextNonspaceColumn: 0,
        indent: 0,
        indented: false,
        blank: false,
        partiallyConsumedTab: false,
        allClosed: true,
        lastMatchedContainer: this.doc,
        refmap: {},
        lastLineLength: 0,
        inlineParser: new InlineParser(options),
        findNextNonspace: findNextNonspace,
        advanceOffset: advanceOffset,
        advanceNextNonspace: advanceNextNonspace,
        addLine: addLine,
        addChild: addChild,
        changeTipType: changeTipType,
        incorporateLine: incorporateLine,
        finalize: finalize,
        processInlines: processInlines,
        closeUnmatchedBlocks: closeUnmatchedBlocks,
        parse: parse,
        options: options
    };
}

export default Parser;
