"use strict";

import Node from "./node.js";
import * as common from "./common.js";
import fromCodePoint from "./from-code-point.js";
import XRegExp from "xregexp";
import "string.prototype.repeat"; // Polyfill for String.prototype.repeat
import {decodeHTMLStrict} from "entities";

var normalizeURI = common.normalizeURI;
var unescapeString = common.unescapeString;

// Constants for character codes:

var C_NEWLINE = 10;
var C_ASTERISK = 42;
var C_UNDERSCORE = 95;
var C_BACKTICK = 96;
var C_OPEN_BRACKET = 91;
var C_CLOSE_BRACKET = 93;
var C_LESSTHAN = 60;
var C_BANG = 33;
var C_BACKSLASH = 92;
var C_AMPERSAND = 38;
var C_OPEN_PAREN = 40;
var C_CLOSE_PAREN = 41;
var C_COLON = 58;
var C_SINGLEQUOTE = 39;
var C_DOUBLEQUOTE = 34;
var C_AT_SIGN = 64;
var C_SEMICOLON = 59;
var C_UPPER_X = 88;
var C_LOWER_X = 120;
var C_TILDE = 126;
var C_NUMBER_SIGN = 35;
var C_DOLLAR_SIGN = 36;

// Some regexps used in inline parser:

var ESCAPABLE = common.ESCAPABLE;
var ESCAPED_CHAR = "\\\\" + ESCAPABLE;

var ENTITY = common.ENTITY;
var reHtmlTag = common.reHtmlTag;

var rePunctuation = new RegExp(
    /^[!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~\p{P}\p{S}]/u);

var reLinkSize = /^=(\d*)(?:x(\d*))?/;

var reLinkTitle = new RegExp(
    '^(?:"(' +
    ESCAPED_CHAR +
    '|\\\\[^\\\\]' +
    '|[^\\\\"\\x00])*"' +
    "|" +
    "'(" +
    ESCAPED_CHAR +
    '|\\\\[^\\\\]' +
    "|[^\\\\'\\x00])*'" +
    "|" +
    "\\((" +
    ESCAPED_CHAR +
    '|\\\\[^\\\\]' +
    "|[^\\\\()\\x00])*\\))"
);

var reLinkDestinationBraces = /^(?:<(?:[^<>\n\\\x00]|\\.)*>)/;

var reEscapable = new RegExp("^" + ESCAPABLE);

var reEntityHere = new RegExp("^" + ENTITY, "i");

var reTicks = /`+/;

var reTicksHere = /^`+/;

var reEllipses = /\.\.\./g;

var reDash = /--+/g;

var reEmailAutolink = /^<([a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;

var reAutolink = /^<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/i;

var reSpnl = /^ *(?:\n *)?/;

var reWhitespaceChar = /^[ \t\n\x0b\x0c\x0d]/;

var reUnicodeWhitespaceChar = /^\s/;

var reFinalSpace = / *$/;

var reInitialSpace = /^ */;

var reSpaceAtEndOfLine = /^ *(?:\n|$)/;

var reNonWord = /^\W+$/;

var reLinkLabel = /^\[(?:[^\\\[\]]|\\.){0,1000}\]/s;

var reDelimChar = /^[*_~]/;

var reDelimCharAll = /^[\W]/;

// Adapted from https://github.com/gregjacobs/Autolinker.js
var emailAlphaNumericChars = "\\p{L}\\p{Nd}";
var emailSpecialCharacters = '!#$%&\'*+\\-\\/=?^_`{|}~';
var emailRestrictedSpecialCharacters = "\\s(),:;<>@\\[\\]";
var emailValidCharacters = emailAlphaNumericChars + emailSpecialCharacters;
var emailValidRestrictedCharacters = emailValidCharacters + emailRestrictedSpecialCharacters;

// Matches a proper email address
var emailStartPattern = "(?:[" + emailValidCharacters + "](?:[" + emailValidCharacters + ']|\\.(?!\\.|@))*|\\"[' + emailValidRestrictedCharacters + '.]+\\")@';

var reDelimChar = /^[*_~]/;

var reDelimCharAll = /^[\W]/

// Adapted from https://github.com/gregjacobs/Autolinker.js
var emailAlphaNumericChars = "\\p{L}\\p{Nd}";
var emailSpecialCharacters = '!#$%&\'*+\\-\\/=?^_`{|}~';
var emailRestrictedSpecialCharacters = "\\s(),:;<>@\\[\\]";
var emailValidCharacters = emailAlphaNumericChars + emailSpecialCharacters;
var emailValidRestrictedCharacters = emailValidCharacters + emailRestrictedSpecialCharacters;

// Matches a proper email address
var emailStartPattern = "(?:[" + emailValidCharacters + "](?:[" + emailValidCharacters + ']|\\.(?!\\.|@))*|\\"[' + emailValidRestrictedCharacters + '.]+\\")@';

// Matches a string of non-special characters.
var reMain = XRegExp.cache('^[\\s\\S]+?(?=[\\n`\\[\\]\\\\!<&*_\'"@:;xX~#$]|[a-z][a-z0-9.+-]{1,31}:|www\\d{0,3}\\.|[' + emailValidCharacters + ".]{1,64}@|$)");

var text = function (s) {
    var node = new Node("text");
    node._literal = s;
    return node;
};

// normalize a reference in reference link (remove []s, trim,
// collapse internal space, unicode case fold.
// See commonmark/commonmark.js#168.
var normalizeReference = function (string) {
    return string
        .slice(1, string.length - 1)
        .trim()
        .replace(/[ \t\r\n]+/g, " ")
        .toLowerCase()
        .toUpperCase();
};

// INLINE PARSER

// These are methods of an InlineParser object, defined below.
// An InlineParser keeps track of a subject (a string to be
// parsed) and a position in that subject.

// If re matches at current position in the subject, advance
// position in subject and return the match; otherwise return null.
var match = function (re) {
    var m = this.matchRegex(re);
    if (m === null) {
        return null;
    } else {
        return m[0];
    }
};

var matchRegex = function (re) {
    var m = re.exec(this.subject.slice(this.pos));
    if (m === null) {
        return null;
    } else {
        this.pos += m.index + m[0].length;
        return m;
    }
};

var tryMatch = function (re) {
    var m = re.exec(this.subject.slice(this.pos));
    if (m === null) {
        return null;
    } else {
        return m;
    }
};

var acceptMatch = function (m) {
    this.pos += m.index + m[0].length;
};

// Returns the code for the character at the current subject position, or -1
// there are no more characters.
// This function must be non-BMP aware because the Unicode category of its result is used.
var peek = function () {
    if (this.pos < this.subject.length) {
        return this.subject.codePointAt(this.pos);
    } else {
        return -1;
    }
};

// Parse zero or more space characters, including at most one newline
var spnl = function () {
    this.match(reSpnl);
    return true;
};

// All of the parsers below try to match something at the current position
// in the subject.  If they succeed in matching anything, they
// return the inline matched, advancing the subject.

// Attempt to parse backticks, adding either a backtick code span or a
// literal sequence of backticks.
var parseBackticks = function (block) {
    var ticks = this.match(reTicksHere);
    if (ticks === null) {
        return false;
    }
    var afterOpenTicks = this.pos;
    var matched;
    var node;
    var contents;
    while ((matched = this.match(reTicks)) !== null) {
        if (matched === ticks) {
            node = new Node("code");
            contents = this.subject
                .slice(afterOpenTicks, this.pos - ticks.length)
                .replace(/\n/gm, " ");
            if (
                contents.length > 0 &&
                contents.match(/[^ ]/) !== null &&
                contents[0] == " " &&
                contents[contents.length - 1] == " "
            ) {
                node._literal = contents.slice(1, contents.length - 1);
            } else {
                node._literal = contents;
            }

            if (block.type === "table_cell") {
                node._literal = node._literal.replace(/\\\|/g, "|");
            }

            block.appendChild(node);
            return true;
        }
    }
    // If we got here, we didn't match a closing backtick sequence.
    this.pos = afterOpenTicks;
    block.appendChild(text(ticks));
    return true;
};

// Parse a backslash-escaped special character, adding either the escaped
// character, a hard line break (if the backslash is followed by a newline),
// or a literal backslash to the block's children.  Assumes current character
// is a backslash.
var parseBackslash = function (block) {
    var subj = this.subject;
    var node;
    this.pos += 1;
    if (this.peek() === C_NEWLINE) {
        this.pos += 1;
        node = new Node("linebreak");
        block.appendChild(node);
    } else if (reEscapable.test(subj.charAt(this.pos))) {
        block.appendChild(text(subj.charAt(this.pos)));
        this.pos += 1;
    } else {
        block.appendChild(text("\\"));
    }
    return true;
};

// Attempt to parse an autolink (URL or email in pointy brackets).
var parseAutolink = function (block) {
    var m;
    var dest;
    var node;
    if ((m = this.match(reEmailAutolink))) {
        dest = m.slice(1, m.length - 1);
        node = new Node("link");
        node._destination = normalizeURI("mailto:" + dest);
        node._title = "";
        node.appendChild(text(dest));
        block.appendChild(node);
        return true;
    } else if ((m = this.match(reAutolink))) {
        dest = m.slice(1, m.length - 1);
        node = new Node("link");
        node._destination = normalizeURI(dest);
        node._title = "";
        node.appendChild(text(dest));
        block.appendChild(node);
        return true;
    } else {
        return false;
    }
};

// Attempt to parse a raw HTML tag.
var parseHtmlTag = function (block) {
    var m = this.match(reHtmlTag);
    if (m === null) {
        return false;
    } else {
        var node = new Node("html_inline");
        node._literal = m;
        block.appendChild(node);
        return true;
    }
};

// Scan a sequence of characters with code cc, and return information about
// the number of delimiters and whether they are positioned such that
// they can open and/or close emphasis or strong emphasis.  A utility
// function for strong/emph parsing.
var scanDelims = function (cc) {
    var numdelims = 0;
    var char_before, char_after, cc_after;
    var startpos = this.pos;
    var left_flanking, right_flanking, can_open, can_close;
    var after_is_whitespace,
        after_is_punctuation,
        before_is_whitespace,
        before_is_punctuation;

    if (cc === C_SINGLEQUOTE || cc === C_DOUBLEQUOTE) {
        numdelims++;
        this.pos++;
    } else {
        while (this.peek() === cc) {
            numdelims++;
            this.pos++;
        }
    }

    if (numdelims === 0 || (cc === C_TILDE && numdelims < 2)) {
        this.pos -= numdelims;
        return null;
    }

    char_before = previousChar(this.subject, startpos);

    cc_after = this.peek();
    if (cc_after === -1) {
        char_after = "\n";
    } else {
        char_after = fromCodePoint(cc_after);
    }

    after_is_whitespace = reUnicodeWhitespaceChar.test(char_after);
    after_is_punctuation = rePunctuation.test(char_after);
    before_is_whitespace = reUnicodeWhitespaceChar.test(char_before);
    before_is_punctuation = rePunctuation.test(char_before);

    left_flanking =
        !after_is_whitespace &&
        (!after_is_punctuation ||
            before_is_whitespace ||
            before_is_punctuation);
    right_flanking =
        !before_is_whitespace &&
        (!before_is_punctuation || after_is_whitespace || after_is_punctuation);
    if (cc === C_UNDERSCORE) {
        can_open = left_flanking && (!right_flanking || before_is_punctuation);
        can_close = right_flanking && (!left_flanking || after_is_punctuation);
    } else if (cc === C_SINGLEQUOTE || cc === C_DOUBLEQUOTE || cc === C_TILDE) {
        can_open = left_flanking && !right_flanking;
        can_close = right_flanking;
    } else {
        can_open = left_flanking;
        can_close = right_flanking;
    }
    this.pos = startpos;
    return {numdelims: numdelims, can_open: can_open, can_close: can_close};

    function previousChar(str, pos) {
        if (pos === 0) {
            return "\n";
        }
        var previous_cc = str.charCodeAt(pos - 1);
        // not low surrogate (BMP)
        if ((previous_cc & 0xfc00) !== 0xdc00) {
            return str.charAt(pos - 1);
        }
        // returns NaN if out of range
        var two_previous_cc = str.charCodeAt(pos - 2);
        // NaN & 0xfc00 = 0
        // checks if 2 previous char is high surrogate
        if ((two_previous_cc & 0xfc00) !== 0xd800) {
            return previous_char;
        }
        return str.slice(pos - 2, pos);
    }
};

// Handle a delimiter marker for emphasis, quotes, or deleted text.
var handleDelim = function (cc, block) {
    var res = this.scanDelims(cc);
    if (!res) {
        return false;
    }
    var numdelims = res.numdelims;
    var startpos = this.pos;
    var contents;

    this.pos += numdelims;
    if (cc === C_SINGLEQUOTE) {
        contents = "\u2019";
    } else if (cc === C_DOUBLEQUOTE) {
        contents = "\u201C";
    } else {
        contents = this.subject.slice(startpos, this.pos);
    }
    var node = text(contents);
    block.appendChild(node);

    // Add entry to stack for this opener
    if (
        (res.can_open || res.can_close) &&
        (this.options.smart || (cc !== C_SINGLEQUOTE && cc !== C_DOUBLEQUOTE))
    ) {
        this.delimiters = {
            cc: cc,
            numdelims: numdelims,
            origdelims: numdelims,
            node: node,
            previous: this.delimiters,
            next: null,
            can_open: res.can_open,
            can_close: res.can_close
        };
        if (this.delimiters.previous !== null) {
            this.delimiters.previous.next = this.delimiters;
        }
    }

    return true;
};

var removeDelimiter = function (delim) {
    if (delim.previous !== null) {
        delim.previous.next = delim.next;
    }
    if (delim.next === null) {
        // top of stack
        this.delimiters = delim.previous;
    } else {
        delim.next.previous = delim.previous;
    }
};

var removeDelimitersBetween = function (bottom, top) {
    if (bottom.next !== top) {
        bottom.next = top;
        top.previous = bottom;
    }
};

var processEmphasis = function (stack_bottom) {
    var opener, closer, old_closer;
    var opener_inl, closer_inl;
    var tempstack;
    var use_delims;
    var tmp, next;
    var opener_found;
    var openers_bottom = [];
    var openers_bottom_index;
    var odd_match = false;

    for (var i = 0; i < 14; i++) {
        openers_bottom[i] = stack_bottom;
    }
    // find first closer above stack_bottom:
    closer = this.delimiters;
    while (closer !== null && closer.previous !== stack_bottom) {
        closer = closer.previous;
    }
    // move forward, looking for closers, and handling each
    while (closer !== null) {
        var closercc = closer.cc;
        if (!closer.can_close) {
            closer = closer.next;
        } else {
            // found emphasis closer. now look back for first matching opener:
            opener = closer.previous;
            opener_found = false;
            switch (closercc) {
                case C_SINGLEQUOTE:
                    openers_bottom_index = 0;
                    break;
                case C_DOUBLEQUOTE:
                    openers_bottom_index = 1;
                    break;
                case C_UNDERSCORE:
                    openers_bottom_index = 2 + (closer.can_open ? 3 : 0)
                        + (closer.origdelims % 3);
                    break;
                case C_ASTERISK:
                    openers_bottom_index = 8 + (closer.can_open ? 3 : 0)
                        + (closer.origdelims % 3);
                    break;
            }
            while (
                opener !== null &&
                opener !== stack_bottom &&
                opener !== openers_bottom[openers_bottom_index]
            ) {
                odd_match =
                    (closer.can_open || opener.can_close) &&
                    closer.origdelims % 3 !== 0 &&
                    (opener.origdelims + closer.origdelims) % 3 === 0;
                if (opener.cc === closer.cc && opener.can_open && (!odd_match || opener.cc === C_TILDE)) {
                    opener_found = true;
                    break;
                }
                opener = opener.previous;
            }
            old_closer = closer;

            if (closercc === C_ASTERISK || closercc === C_UNDERSCORE) {
                if (!opener_found) {
                    closer = closer.next;
                } else {
                    // calculate actual number of delimiters used from closer
                    use_delims =
                        closer.numdelims >= 2 && opener.numdelims >= 2 ? 2 : 1;

                    opener_inl = opener.node;
                    closer_inl = closer.node;

                    // remove used delimiters from stack elts and inlines
                    opener.numdelims -= use_delims;
                    closer.numdelims -= use_delims;
                    opener_inl._literal = opener_inl._literal.slice(
                        0,
                        opener_inl._literal.length - use_delims
                    );
                    closer_inl._literal = closer_inl._literal.slice(
                        0,
                        closer_inl._literal.length - use_delims
                    );

                    // build contents for new emph element
                    var emph = new Node(use_delims === 1 ? "emph" : "strong");

                    tmp = opener_inl._next;
                    while (tmp && tmp !== closer_inl) {
                        next = tmp._next;
                        tmp.unlink();
                        emph.appendChild(tmp);
                        tmp = next;
                    }

                    opener_inl.insertAfter(emph);

                    // remove elts between opener and closer in delimiters stack
                    removeDelimitersBetween(opener, closer);

                    // if opener has 0 delims, remove it and the inline
                    if (opener.numdelims === 0) {
                        opener_inl.unlink();
                        this.removeDelimiter(opener);
                    }

                    if (closer.numdelims === 0) {
                        closer_inl.unlink();
                        tempstack = closer.next;
                        this.removeDelimiter(closer);
                        closer = tempstack;
                    }
                }

            } else if (closercc === C_TILDE) {
                if (!opener_found) {
                    closer = closer.next;
                } else {
                    opener_inl = opener.node;
                    closer_inl = closer.node;

                    // build contents for new del element
                    var emph = new Node("del");

                    tmp = opener_inl._next;
                    while (tmp && tmp !== closer_inl) {
                        next = tmp._next;
                        tmp.unlink();
                        emph.appendChild(tmp);
                        tmp = next;
                    }

                    opener_inl.insertAfter(emph);

                    // remove elts between opener and closer in delimiters stack
                    removeDelimitersBetween(opener, closer);

                    // remove the opening and closing delimiters
                    opener_inl.unlink();
                    this.removeDelimiter(opener);

                    closer_inl.unlink();
                    tempstack = closer.next;
                    this.removeDelimiter(closer);
                    closer = tempstack;
                }

            } else if (closercc === C_SINGLEQUOTE) {
                closer.node._literal = "\u2019";
                if (opener_found) {
                    opener.node._literal = "\u2018";
                }
                closer = closer.next;
            } else if (closercc === C_DOUBLEQUOTE) {
                closer.node._literal = "\u201D";
                if (opener_found) {
                    opener.node.literal = "\u201C";
                }
                closer = closer.next;
            }
            if (!opener_found) {
                // Set lower bound for future searches for openers:
                openers_bottom[openers_bottom_index] =
                    old_closer.previous;
                if (!old_closer.can_open) {
                    // We can remove a closer that can't be an opener,
                    // once we've seen there's no matching opener:
                    this.removeDelimiter(old_closer);
                }
            }
        }
    }

    // remove all delimiters
    while (this.delimiters !== null && this.delimiters !== stack_bottom) {
        this.removeDelimiter(this.delimiters);
    }
};

var parseLinkSize = function () {
    var size_matches = this.match(reLinkSize);

    if (size_matches === null) {
        return null;
    } else {
        var detailed = size_matches.match(reLinkSize);
        var width = detailed[1];
        var height = detailed[2];
        var size = {};

        if (width) {
            size.width = parseInt(width);
        }

        if (height) {
            size.height = parseInt(height);
        }

        return size;
    }
}

// Attempt to parse link title (sans quotes), returning the string
// or null if no match.
var parseLinkTitle = function () {
    var title = this.match(reLinkTitle);
    if (title === null) {
        return null;
    } else {
        // chop off quotes from title and unescape:
        return unescapeString(title.slice(1, -1));
    }
};

// Attempt to parse link destination, returning the string or
// null if no match.
var parseLinkDestination = function () {
    var res = this.match(reLinkDestinationBraces);
    if (res === null) {
        if (this.peek() === C_LESSTHAN) {
            return null;
        }
        // TODO handrolled parser; res should be null or the string
        var savepos = this.pos;
        var openparens = 0;
        var c;
        while ((c = this.peek()) !== -1) {
            if (
                c === C_BACKSLASH &&
                reEscapable.test(this.subject.charAt(this.pos + 1))
            ) {
                this.pos += 1;
                if (this.peek() !== -1) {
                    this.pos += 1;
                }
            } else if (c === C_OPEN_PAREN) {
                this.pos += 1;
                openparens += 1;
            } else if (c === C_CLOSE_PAREN) {
                if (openparens < 1) {
                    break;
                } else {
                    this.pos += 1;
                    openparens -= 1;
                }
            } else if (reWhitespaceChar.exec(fromCodePoint(c)) !== null) {
                break;
            } else {
                this.pos += 1;
            }
        }
        if (this.pos === savepos && c !== C_CLOSE_PAREN) {
            return null;
        }
        if (openparens !== 0) {
            return null;
        }
        res = this.subject.slice(savepos, this.pos);
        return normalizeURI(unescapeString(res));
    } else {
        // chop off surrounding <..>:
        return normalizeURI(unescapeString(res.slice(1, -1)));
    }
};

// Attempt to parse a link label, returning number of characters parsed.
var parseLinkLabel = function () {
    var m = this.match(reLinkLabel);
    if (m === null || m.length > 1001) {
        return 0;
    } else {
        return m.length;
    }
};

// Add open bracket to delimiter stack and add a text node to block's children.
var parseOpenBracket = function (block) {
    var startpos = this.pos;
    this.pos += 1;

    var node = text("[");
    block.appendChild(node);

    // Add entry to stack for this opener
    this.addBracket(node, startpos, false);
    return true;
};

// IF next character is [, and ! delimiter to delimiter stack and
// add a text node to block's children.  Otherwise just add a text node.
var parseBang = function (block) {
    var startpos = this.pos;
    this.pos += 1;
    if (this.peek() === C_OPEN_BRACKET) {
        this.pos += 1;

        var node = text("![");
        block.appendChild(node);

        // Add entry to stack for this opener
        this.addBracket(node, startpos + 1, true);
    } else {
        block.appendChild(text("!"));
    }
    return true;
};

// Try to match close bracket against an opening in the delimiter
// stack.  Add either a link or image, or a plain [ character,
// to block's children.  If there is a matching delimiter,
// remove it from the delimiter stack.
var parseCloseBracket = function (block) {
    var startpos;
    var is_image;
    var dest;
    var size;
    var title;
    var matched = false;
    var reflabel;
    var opener;

    this.pos += 1;
    startpos = this.pos;

    // get last [ or ![
    opener = this.brackets;

    if (opener === null) {
        // no matched opener, just return a literal
        block.appendChild(text("]"));
        return true;
    }

    if (!opener.active) {
        // no matched opener, just return a literal
        block.appendChild(text("]"));
        // take opener off brackets stack
        this.removeBracket();
        return true;
    }

    // If we got here, open is a potential opener
    is_image = opener.image;

    // Check to see if we have a link/image

    var savepos = this.pos;

    // Inline link?
    if (this.peek() === C_OPEN_PAREN) {
        this.pos++;
        if (
            this.spnl() &&
            (dest = this.parseLinkDestination()) !== null &&
            this.spnl() &&
            (size = this.parseLinkSize() || true) &&
            this.spnl() &&
            // make sure there's a space before the title:
            ((reWhitespaceChar.test(this.subject.charAt(this.pos - 1)) &&
                (title = this.parseLinkTitle())) ||
                true) &&
            this.spnl() &&
            this.peek() === C_CLOSE_PAREN
        ) {
            this.pos += 1;
            matched = true;
        } else {
            this.pos = savepos;
        }
    }

    if (!matched) {
        // Next, see if there's a link label
        var beforelabel = this.pos;
        var n = this.parseLinkLabel();
        if (n > 2) {
            reflabel = this.subject.slice(beforelabel, beforelabel + n);
        } else if (!opener.bracketAfter) {
            // Empty or missing second label means to use the first label as the reference.
            // The reference must not contain a bracket. If we know there's a bracket, we don't even bother checking it.
            reflabel = this.subject.slice(opener.index, startpos);
        }
        if (n === 0) {
            // If shortcut reference link, rewind before spaces we skipped.
            this.pos = savepos;
        }

        if (reflabel) {
            // lookup rawlabel in refmap
            var link = this.refmap[normalizeReference(reflabel)];
            if (link) {
                dest = link.destination;
                title = link.title;
                matched = true;
            }
        }
    }

    if (matched) {
        var node = new Node(is_image ? "image" : "link");
        node._destination = dest;
        node._title = title || "";
        node._size = size;

        var tmp, next;
        tmp = opener.node._next;
        while (tmp) {
            next = tmp._next;
            tmp.unlink();
            node.appendChild(tmp);
            tmp = next;
        }
        block.appendChild(node);
        this.processEmphasis(opener.previousDelimiter);
        this.removeBracket();
        opener.node.unlink();

        // We remove this bracket and processEmphasis will remove later delimiters.
        // Now, for a link, we also deactivate earlier link openers.
        // (no links in links)
        if (!is_image) {
            opener = this.brackets;
            while (opener !== null) {
                if (!opener.image) {
                    opener.active = false; // deactivate this opener
                }
                opener = opener.previous;
            }
        }

        return true;
    } else {
        // no match

        this.removeBracket(); // remove this opener from stack
        this.pos = startpos;
        block.appendChild(text("]"));
        return true;
    }
};

var addBracket = function (node, index, image) {
    if (this.brackets !== null) {
        this.brackets.bracketAfter = true;
    }
    this.brackets = {
        node: node,
        previous: this.brackets,
        previousDelimiter: this.delimiters,
        index: index,
        image: image,
        active: true
    };
};

var removeBracket = function () {
    this.brackets = this.brackets.previous;
};

// Attempt to parse an entity.
var parseEntity = function (block) {
    var m;
    if ((m = this.match(reEntityHere))) {
        block.appendChild(text(decodeHTMLStrict(m)));
        return true;
    } else {
        return false;
    }
};

// Attempt to parse a url
var reUrl = XRegExp.cache('^(?:[A-Za-z][A-Za-z\\d-.+]*:(?:\\/{1,3}|[\\pL\\d%])|www\\d{0,3}[.]|[\\pL\\d.\\-]+[.]\\pL{2,4}\\/)(?:\\[[\\da-f:]+\\]|[^\\s`!()\\[\\]{;:\'",<>?«»“”‘’*_]|[*_]+(?=[^_*\\s])|[`!\\[\\]{;:\'",<>?«»“”‘’](?=[^\\s()<>])|\\((?:[^\\s()<>]|(?:\\([^\\s()<>]+\\)))*\\))+', 'i');
var parseUrl = function (block) {
    if (this.brackets) {
        // Don't perform autolinking while inside an explicit link
        return false;
    }

    var m;
    if ((m = this.tryMatch(reUrl))) {
        // Only link urls after non-word, non-formatting characters
        if (this.pos !== 0 && this.subject[this.pos - 1] !== "_" && !reNonWord.test(this.subject[this.pos - 1])) {
            return false;
        }

        // Step back to remove trailing punctuation like how GitHub does
        // https://github.com/github/cmark/blob/master/extensions/autolink.c#L58
        var url = m[0];
        while ((/[?!.,,:*_~'"]$/).test(url)) {
            url = url.substring(0, url.length - 1);
        }

        if (this.options.urlFilter && !this.options.urlFilter(url)) {
            return false;
        }

        this.pos += m.index + url.length;

        var node = new Node("link");
        node._destination = normalizeURI(url);
        node._title = "";
        node.appendChild(text(url));
        block.appendChild(node);

        return true;
    } else {
        return false;
    }
}

// Attempt to parse an at mention
var reAtMention = /^@([a-z][a-z0-9._-]*)/i;
var parseAtMention = function (block) {
    if (this.brackets) {
        // Don't perform autolinking while inside an explicit link
        return false;
    }

    var m;
    if ((m = this.tryMatch(reAtMention))) {
        // Only allow at mentions after non-word characters
        if (this.pos === 0 || reNonWord.test(this.subject[this.pos - 1])) {
            this.acceptMatch(m);

            // It's up to the renderer to determine what part of this is actually a username
            var node = new Node("at_mention");
            node._mentionName = m[1];
            block.appendChild(node);
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
}

// Attempt to parse a channel link
var reChannelLink = /^~([a-z0-9_-]+)/i;
var parseChannelLink = function (block) {
    if (this.brackets) {
        // Don't perform autolinking while inside an explicit link
        return false;
    }

    var m;
    if ((m = this.tryMatch(reChannelLink))) {
        // Only allow channel links after non-word characters
        if (this.pos === 0 || reNonWord.test(this.subject[this.pos - 1])) {
            this.acceptMatch(m);

            // It's up to the renderer to determine if this is actually a channel link
            var node = new Node("channel_link");
            node._channelName = m[1];
            block.appendChild(node);
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
}

// Attempt to parse a named emoji
var reEmoji = /^:([a-z0-9_\-+]+):\B/i;
var parseEmoji = function (block) {
    var m;
    if ((m = this.tryMatch(reEmoji))) {
        // Only allow emojis after non-word characters
        if (this.pos === 0 || reNonWord.test(this.subject[this.pos - 1])) {
            this.acceptMatch(m);

            // It's up to the renderer to determine if this is a real emoji
            var node = new Node("emoji");
            node._literal = m[0];
            node._emojiName = m[1];
            block.appendChild(node);
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
}

// Attempt to parse an emoticon (eg. :D, <3)
var reEmoticon = /^(?:(:-?\))|(;-?\))|(:o)|(:-o)|(:-?])|(:-?d)|(x-d)|(:-?p)|(:-?[[@])|(:-?\()|(:[`'’]-?\()|(:-?\/)|(:-?s)|(:-?\|)|(:-?\$)|(:-x)|(<3|&lt;3)|(<\/3|&lt;\/3))(?=$|\W)/i;
var EMOTICONS = [
    "slightly_smiling_face",
    "wink",
    "open_mouth",
    "scream",
    "smirk",
    "smile",
    "stuck_out_tongue_closed_eyes",
    "stuck_out_tongue",
    "rage",
    "slightly_frowning_face",
    "cry",
    "confused",
    "confounded",
    "neutral_face",
    "flushed",
    "mask",
    "heart",
    "broken_heart"
];
var parseEmoticon = function (block) {
    var m;
    if ((m = this.tryMatch(reEmoticon))) {
        // Only allow emoticons after whitespace or a delimiter
        if (this.pos === 0 || reWhitespaceChar.test(this.subject[this.pos - 1]) || reDelimCharAll.test(this.subject[this.pos - 1])) {
            this.acceptMatch(m);

            var node = new Node("emoji");
            node._literal = m[0];

            // Capture groups in the regex correspond to entries in EMOTICONS
            for (var i = 0; i < EMOTICONS.length; i++) {
                if (m[i + 1]) {
                    node._emojiName = EMOTICONS[i];
                }
            }

            block.appendChild(node);
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
}

var reEmail = XRegExp.cache("^" + emailStartPattern + "[\\pL\\d.\\-]+[.]\\pL{2,4}(?=$|[^\\p{L}])");
var parseEmail = function (block) {
    if (this.brackets) {
        // Don't perform autolinking while inside an explicit link
        return false;
    }

    var m;
    if ((m = this.tryMatch(reEmail))) {
        // Only allow at mentions after non-word characters
        if (this.pos === 0 || reNonWord.test(this.subject[this.pos - 1])) {
            this.acceptMatch(m);

            var dest = m[0];

            var node = new Node("link");
            node._destination = normalizeURI("mailto:" + dest);
            node._title = "";

            node.appendChild(text(m[0]));
            block.appendChild(node);
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
}

var reHashtag = XRegExp.cache("^#(\\pL[\\pL\\d\\-_.]*[\\pL\\d])");
var parseHashtag = function (block) {
    if (this.brackets) {
        // Don't perform autolinking while inside an explicit link
        return false;
    }

    var m;
    if ((m = this.tryMatch(reHashtag, true))) {
        // Only allow hashtags after a non-word character or a delimiter and only allow hashtags that are long enough
        if (
            (this.pos === 0 || reNonWord.test(this.subject[this.pos - 1]) || reDelimChar.test(this.subject[this.pos - 1])) &&
            m[1].length >= this.options.minimumHashtagLength
        ) {
            this.acceptMatch(m);

            var node = new Node("hashtag");
            node._hashtag = m[1];
            node.appendChild(text(m[0]));
            block.appendChild(node);
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
}

var reInlineLatex = /^\$([^\$\n]+)\$(?!\w)/;
var parseInlineLatex = function (block) {

    if (this.brackets) {
        // Don't perform autolinking while inside an explicit link
        return false;
    }

    if (this.delimiters) {
        return false;
    }

    var m;
    if ((m = this.tryMatch(reInlineLatex, true))) {
        //Only allow for inline latex if the dollarsign was present after a non-word character
        if (
            (this.pos === 0 || reNonWord.test(this.subject[this.pos - 1]) || reDelimChar.test(this.subject[this.pos - 1]))
        ) {
            this.acceptMatch(m);

            var node = new Node("latex_inline");
            node._latexCode = m[1].trim();
            node.appendChild(text(m[0]));
            block.appendChild(node);
            return true;
        } else {
            return false;
        }
    }
}

// Parse a run of ordinary characters, or a single character with
// a special meaning in markdown, as a plain string.
var parseString = function (block) {
    var m;
    if ((m = this.match(reMain))) {
        if (this.options.smart) {
            block.appendChild(
                text(
                    m
                        .replace(reEllipses, "\u2026")
                        .replace(reDash, function (chars) {
                            var enCount = 0;
                            var emCount = 0;
                            if (chars.length % 3 === 0) {
                                // If divisible by 3, use all em dashes
                                emCount = chars.length / 3;
                            } else if (chars.length % 2 === 0) {
                                // If divisible by 2, use all en dashes
                                enCount = chars.length / 2;
                            } else if (chars.length % 3 === 2) {
                                // If 2 extra dashes, use en dash for last 2; em dashes for rest
                                enCount = 1;
                                emCount = (chars.length - 2) / 3;
                            } else {
                                // Use en dashes for last 4 hyphens; em dashes for rest
                                enCount = 2;
                                emCount = (chars.length - 4) / 3;
                            }
                            return (
                                "\u2014".repeat(emCount) +
                                "\u2013".repeat(enCount)
                            );
                        })
                )
            );
        } else {
            block.appendChild(text(m));
        }
        return true;
    } else {
        return false;
    }
};

// Parse a newline.  If it was preceded by two spaces, return a hard
// line break; otherwise a soft line break.
var parseNewline = function (block) {
    this.pos += 1; // assume we're at a \n
    // check previous node for trailing spaces
    var lastc = block._lastChild;
    if (
        lastc &&
        lastc.type === "text" &&
        lastc._literal[lastc._literal.length - 1] === " "
    ) {
        var hardbreak = lastc._literal[lastc._literal.length - 2] === " ";
        lastc._literal = lastc._literal.replace(reFinalSpace, "");
        block.appendChild(new Node(hardbreak ? "linebreak" : "softbreak"));
    } else {
        block.appendChild(new Node("softbreak"));
    }
    this.match(reInitialSpace); // gobble leading spaces in next line
    return true;
};

// Attempt to parse a link reference, modifying refmap.
var parseReference = function (s, refmap) {
    this.subject = s;
    this.pos = 0;
    var rawlabel;
    var dest;
    var title;
    var matchChars;
    var startpos = this.pos;

    // label:
    matchChars = this.parseLinkLabel();
    if (matchChars === 0) {
        return 0;
    } else {
        rawlabel = this.subject.slice(0, matchChars);
    }

    // colon:
    if (this.peek() === C_COLON) {
        this.pos++;
    } else {
        this.pos = startpos;
        return 0;
    }

    //  link url
    this.spnl();

    dest = this.parseLinkDestination();
    if (dest === null) {
        this.pos = startpos;
        return 0;
    }

    var beforetitle = this.pos;
    this.spnl();
    if (this.pos !== beforetitle) {
        title = this.parseLinkTitle();
    }
    if (title === null) {
        // rewind before spaces
        this.pos = beforetitle;
    }

    // make sure we're at line end:
    var atLineEnd = true;
    if (this.match(reSpaceAtEndOfLine) === null) {
        if (title === null) {
            atLineEnd = false;
        } else {
            // the potential title we found is not at the line end,
            // but it could still be a legal link reference if we
            // discard the title
            title = null;
            // rewind before spaces
            this.pos = beforetitle;
            // and instead check if the link URL is at the line end
            atLineEnd = this.match(reSpaceAtEndOfLine) !== null;
        }
    }

    if (!atLineEnd) {
        this.pos = startpos;
        return 0;
    }

    var normlabel = normalizeReference(rawlabel);
    if (normlabel === "") {
        // label must contain non-whitespace characters
        this.pos = startpos;
        return 0;
    }

    if (!refmap[normlabel]) {
        refmap[normlabel] = {destination: dest, title: title === null ? "" : title};
    }
    return this.pos - startpos;
};

// Parse the next inline element in subject, advancing subject position.
// On success, add the result to block's children and return true.
// On failure, return false.
var parseInline = function (block) {
    var res = false;
    var c = this.peek();
    if (c === -1) {
        return false;
    }
    switch (c) {
        case C_NEWLINE:
            res = this.parseNewline(block);
            break;
        case C_BACKSLASH:
            res = this.parseBackslash(block);
            break;
        case C_BACKTICK:
            res = this.parseBackticks(block);
            break;
        case C_ASTERISK:
        case C_UNDERSCORE:
            res = this.handleDelim(c, block);
            break;
        case C_SINGLEQUOTE:
        case C_DOUBLEQUOTE:
            res = this.options.smart && this.handleDelim(c, block);
            break;
        case C_OPEN_BRACKET:
            res = this.parseOpenBracket(block);
            break;
        case C_BANG:
            res = this.parseBang(block);
            break;
        case C_CLOSE_BRACKET:
            res = this.parseCloseBracket(block);
            break;
        case C_LESSTHAN:
            res = this.parseAutolink(block) || this.parseHtmlTag(block) || this.parseEmoticon(block);
            break;
        case C_AMPERSAND:
            res = this.parseEmoticon(block) || this.parseEntity(block);
            break;
        case C_AT_SIGN:
            res = this.parseAtMention(block);
            break;
        case C_TILDE:
            res = this.handleDelim(c, block) || this.parseChannelLink(block);
            break;
        case C_COLON:
            res = this.parseEmoji(block) || this.parseEmoticon(block);
            break;
        case C_SEMICOLON:
            res = this.parseEmoticon(block);
            break;
        case C_UPPER_X:
        case C_LOWER_X:
            res = this.parseEmoticon(block);
            break;
        case C_NUMBER_SIGN:
            res = this.parseHashtag(block);
            break;
        case C_DOLLAR_SIGN:
            res = this.parseInlineLatex(block);
            break;
        default:
            break;
    }

    if (!res) {
        res = this.parseEmail(block);
    }

    if (!res) {
        res = this.parseUrl(block);
    }

    // parseString always captures at least a single character
    if (!res) {
        res = this.parseString(block);
    }

    return true;
};

// Parse string content in block into inline children,
// using refmap to resolve references.
var parseInlines = function (block) {
    // String.protoype.trim() removes non-ASCII whitespaces, vertical tab, form feed and so on.
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/trim#return_value
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#white_space
    // Removes only ASCII tab and space.
    this.subject = trim(block._string_content)
    this.pos = 0;
    this.delimiters = null;
    this.brackets = null;
    while (this.parseInline(block)) { }
    block._string_content = null; // allow raw string to be garbage collected
    this.processEmphasis(null);

    function trim(str) {
        var start = 0;
        for (; start < str.length; start++) {
            if (!isSpace(str.charCodeAt(start))) {
                break;
            }
        }
        var end = str.length - 1;
        for (; end >= start; end--) {
            if (!isSpace(str.charCodeAt(end))) {
                break;
            }
        }
        return str.slice(start, end + 1);

        function isSpace(c) {
            // U+0020 = space, U+0009 = tab, U+000A = LF, U+000D = CR
            return c === 0x20 || c === 9 || c === 0xa || c === 0xd;
        }
    }
};

// The InlineParser object.
function InlineParser(options) {
    return {
        subject: "",
        delimiters: null, // used by handleDelim method
        brackets: null,
        pos: 0,
        refmap: {},
        match: match,
        matchRegex: matchRegex,
        tryMatch: tryMatch,
        acceptMatch: acceptMatch,
        peek: peek,
        spnl: spnl,
        parseBackticks: parseBackticks,
        parseBackslash: parseBackslash,
        parseAutolink: parseAutolink,
        parseHtmlTag: parseHtmlTag,
        scanDelims: scanDelims,
        handleDelim: handleDelim,
        parseLinkSize: parseLinkSize,
        parseLinkTitle: parseLinkTitle,
        parseLinkDestination: parseLinkDestination,
        parseLinkLabel: parseLinkLabel,
        parseOpenBracket: parseOpenBracket,
        parseBang: parseBang,
        parseCloseBracket: parseCloseBracket,
        addBracket: addBracket,
        removeBracket: removeBracket,
        parseEntity: parseEntity,
        parseUrl: parseUrl,
        parseAtMention: parseAtMention,
        parseChannelLink: parseChannelLink,
        parseEmoji: parseEmoji,
        parseEmoticon: parseEmoticon,
        parseEmail: parseEmail,
        parseHashtag: parseHashtag,
        parseInlineLatex: parseInlineLatex,
        parseString: parseString,
        parseNewline: parseNewline,
        parseReference: parseReference,
        parseInline: parseInline,
        processEmphasis: processEmphasis,
        removeDelimiter: removeDelimiter,
        options: options || {},
        parse: parseInlines
    };
}

export default InlineParser;
