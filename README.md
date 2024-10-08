Mattermost fork of commonmark.js
=============

This is the fork of [commonmark.js](https://github.com/commonmark/commonmark.js) used by Mattermost which includes Mattermost-specific features and some changes to the CommonMark spec. A non-exhaustive list of the changes are:
1. Made some changes to how some block elements like list items are continued (or not) after line breaks.
2. Added new features such as URL autolinking, at-mentions, hashtags, emojis, emoticons, and tables.
3. Added some fields to the AST to support new node types for the features mentioned above as well as some others introduced via transforms in the Mattermost mobile app.
4. Added integrated type definitions.

---

[![Build Status](https://github.com/commonmark/commonmark.js/workflows/CI%20tests/badge.svg)](https://github.com/commonmark/commonmark.js/actions)
[![NPM version](https://img.shields.io/npm/v/commonmark.svg?style=flat)](https://www.npmjs.org/package/commonmark)


CommonMark is a rationalized version of Markdown syntax,
with a [spec][the spec] and BSD-licensed reference
implementations in C and JavaScript.

  [the spec]: http://spec.commonmark.org

For more information, see <http://commonmark.org>.

(**Mattermost**) Note that we diverge from this spec in a few ways.
These will eventually be more thoroughly documented with our own
version of the spec, but that has not been done yet.

This repository contains the JavaScript reference implementation.
It provides a library with functions for parsing CommonMark
documents to an abstract syntax tree (AST), manipulating the AST,
and rendering the document to HTML or to an XML representation of the
AST.

To play with this library without installing it, see
the live dingus at <http://try.commonmark.org/>.

Installing
----------

You can install the library using `npm`:

    npm install @mattermost/commonmark

This package includes the commonmark library and a
command-line executable, `commonmark`.

For client-side use, you can use one of the single-file
distributions provided in the `dist/` subdirectory
of the node installation (`node_modules/commonmark/dist/`).
Use either `commonmark.js` (readable source) or
`commonmark.min.js` (minimized source).

Alternatively, `bower install commonmark` will install
the needed distribution files in
`bower_components/commonmark/dist`.

You can also use the version hosted by unpkg: for example,
<https://unpkg.com/commonmark@0.29.3/dist/commonmark.js>
for the unminimized version 0.29.3.


Building
--------

Make sure to fetch dependencies with:

    npm install

To run tests for the JavaScript library:

    npm test

(Running the tests will also rebuild distribution files in
`dist/`.)

To run benchmarks against some other JavaScript converters:

    make bench

To start an interactive dingus that you can use to try out
the library:

    make dingus

Usage
-----

Instead of converting Markdown directly to HTML, as most converters
do, `commonmark.js` parses Markdown to an AST (abstract syntax tree),
and then renders this AST as HTML.  This opens up the possibility of
manipulating the AST between parsing and rendering.  For example, one
could transform emphasis into ALL CAPS.

Here's a basic usage example:

``` js
var reader = new commonmark.Parser();
var writer = new commonmark.HtmlRenderer();
var parsed = reader.parse("Hello *world*"); // parsed is a 'Node' tree
// transform parsed if you like...
var result = writer.render(parsed); // result is a String
```

The constructors for `Parser` and `HtmlRenderer` take an optional
`options` parameter:

``` js
var reader = new commonmark.Parser({smart: true});
var writer = new commonmark.HtmlRenderer({sourcepos: true});
```

`Parser` currently supports the following:

- `smart`:  if `true`, straight quotes will be made curly, `--` will
  be changed to an en dash, `---` will be changed to an em dash, and
  `...` will be changed to ellipses.

Both `HtmlRenderer` and `XmlRenderer` (see below) support these options:

- `sourcepos`:  if `true`, source position information for block-level
  elements will be rendered in the `data-sourcepos` attribute (for
  HTML) or the `sourcepos` attribute (for XML).
- `safe`: if `true`, raw HTML will not be passed through to HTML
  output (it will be replaced by comments), and potentially unsafe
  URLs in links and images (those beginning with `javascript:`,
  `vbscript:`, `file:`, and with a few exceptions `data:`) will
  be replaced with empty strings.
- `softbreak`: specify raw string to be used for a softbreak.
- `esc`: specify a function to be used to escape strings.  Its 
  argument is the string.

For example, to make soft breaks render as hard breaks in HTML:

``` js
var writer = new commonmark.HtmlRenderer({softbreak: "<br />"});
```

To make them render as spaces:

``` js
var writer = new commonmark.HtmlRenderer({softbreak: " "});
```

`XmlRenderer` serves as an alternative to `HtmlRenderer` and
will produce an XML representation of the AST:

``` js
var writer = new commonmark.XmlRenderer({sourcepos: true});
```

The parser returns a Node.  The following public properties are defined
(those marked "read-only" have only a getter, not a setter):

- `type` (read-only):  a String, one of
  `text`, `softbreak`, `linebreak`, `emph`, `strong`,
  `html_inline`, `link`, `image`, `code`, `document`, `paragraph`,
  `block_quote`, `item`, `list`, `heading`, `code_block`,
  `html_block`, `thematic_break`.
    - (**Mattermost**) This fork also adds `at_mention`,
    `channel_link`, `emoji`, `hashtag`, `latex_inline`, 
    `mention_highlight`, `highlight_without_notification`, `search_highlight`, `table`, `table_row`,
    `table_cell`, `edited_indicator`, `checkbox`.
- `firstChild` (read-only):  a Node or null.
- `lastChild` (read-only): a Node or null.
- `next` (read-only): a Node or null.
- `prev` (read-only): a Node or null.
- `parent` (read-only): a Node or null.
- `sourcepos` (read-only): an Array with the following form:
  `[[startline, startcolumn], [endline, endcolumn]]`.
- `isContainer` (read-only): `true` if the Node can contain other
   Nodes as children.
- `literal`: the literal String content of the node or null.
- `destination`: link or image destination (String) or null.
- `title`: link or image title (String) or null.
- `info`: fenced code block info string (String) or null.
- `level`: heading level (Number).
- `listType`: a String, either `bullet` or `ordered`.
- `listTight`: `true` if list is tight.
- `listStart`: a Number, the starting number of an ordered list.
- `listDelimiter`: a String, either `)` or `.` for an ordered list.
- (**Mattermost**) `mentionName`: a String containing the
   at-mentioned user/group or null.
- (**Mattermost**) `channelName`: a String containing the linked
   channel or null.
- (**Mattermost**) `emojiName`: a String containing the name of
   the emoji or null.
- (**Mattermost**) `hashtag`: a String containing the hashtag text
   or null.
- (**Mattermost**) `latexCode`: a String containing the Latex content
   of this Node or null.
- (**Mattermost**) `isChecked`: `true` if this is a checked `checkbox`.
- (**Mattermost**) `alignColumns`: if this is a `table_row`, an array of
   Strings containing the alignment of each column.
- (**Mattermost**) `isHeading`: if this is a `table_row` or `table_cell`,
   whether or not this is part of the first row of the table.
- (**Mattermost**) `align`: if this is a `table_cell`, the alignment of
   this cell, either the empty string, `center`, `left`, or `right`.
- `onEnter`, `onExit`: Strings, used only for `custom_block` or
  `custom_inline`.

Nodes have the following public methods:

- `appendChild(child)`:  Append a Node `child` to the end of the
  Node's children.
- `prependChild(child)`:  Prepend a Node `child` to the
  beginning of the Node's children.
- `unlink()`:  Remove the Node from the tree, severing its links
  with siblings and parents, and closing up gaps as needed.
- `insertAfter(sibling)`: Insert a Node `sibling` after the Node.
- `insertBefore(sibling)`: Insert a Node `sibling` before the Node.
- `walker()`: Returns a NodeWalker that can be used to iterate through
  the Node tree rooted in the Node.

The NodeWalker returned by `walker()` has two methods:

- `next()`: Returns an object with properties `entering` (a boolean,
  which is `true` when we enter a Node from a parent or sibling, and
  `false` when we reenter it from a child).  Returns `null` when
  we have finished walking the tree.
- `resumeAt(node, entering)`: Resets the iterator to resume at the
  specified node and setting for `entering`.  (Normally this isn't
  needed unless you do destructive updates to the Node tree.)

Here is an example of the use of a NodeWalker to iterate through
the tree, making transformations.  This simple example converts
the contents of all `text` nodes to ALL CAPS:

``` js
var walker = parsed.walker();
var event, node;

while ((event = walker.next())) {
  node = event.node;
  if (event.entering && node.type === 'text') {
    node.literal = node.literal.toUpperCase();
  }
}
```

This more complex example converts emphasis to ALL CAPS:

``` js
var walker = parsed.walker();
var event, node;
var inEmph = false;

while ((event = walker.next())) {
  node = event.node;
  if (node.type === 'emph') {
    if (event.entering) {
      inEmph = true;
    } else {
      inEmph = false;
      // add Emph node's children as siblings
      while (node.firstChild) {
        node.insertBefore(node.firstChild);
      }
      // remove the empty Emph node
      node.unlink()
    }
  } else if (inEmph && node.type === 'text') {
      node.literal = node.literal.toUpperCase();
  }
}
```

Exercises for the reader:  write a transform to

1. De-linkify a document, transforming links to regular text.
2. Remove all raw HTML (`html_inline` and `html_block` nodes).
3. Run fenced code blocks marked with a language name through
   a syntax highlighting library, replacing them with an `HtmlBlock`
   containing the highlighted code.
4. Print warnings to the console for images without image
   descriptions or titles.

Command line
------------

The command line executable parses CommonMark input from the
specified files, or from stdin if no files are specified, and
renders the result to stdout as HTML.  If multiple input files
are specified, their contents are concatenated before parsing,
with newlines between them.

```
commonmark inputfile.md > outputfile.html
commonmark intro.md chapter1.md chapter2.md > book.html
```

Use `commonmark --help` to get a summary of options.

A note on security
------------------

The library does not attempt to sanitize link attributes or
raw HTML.  If you use this library in applications that accept
untrusted user input, you should either enable the `safe` option
(see above) or run the output through an HTML sanitizer to protect against
[XSS attacks](http://en.wikipedia.org/wiki/Cross-site_scripting).

Performance
-----------

Performance is excellent, roughly on par with `marked`.  On a benchmark
converting an 11 MB Markdown file built by concatenating the Markdown
sources of all localizations of the first edition of
[*Pro Git*](https://github.com/progit/progit/tree/master/en) by Scott
Chacon, the command-line tool, `commonmark` is just a bit slower than
the C program `discount`, roughly ten times faster than PHP Markdown,
a hundred times faster than Python Markdown, and more than
a thousand times faster than `Markdown.pl`.

Here are some focused benchmarks of four JavaScript libraries
(using versions available on 24 Jan 2015).  They test performance
on different kinds of Markdown texts.  (Most of these samples
are taken from the
[markdown-it](https://github.com/markdown-it/markdown-it)
repository.)  Results show a ratio of ops/second (higher is better)
against showdown (which is usually the slowest implementation).
Versions: showdown 1.3.0, marked 0.3.5, commonmark.js 0.22.1,
markdown-it 5.0.2, node 5.3.0.  Hardware: 1.6GHz Intel Core i5, Mac OSX.

| Sample                   |showdown  |commonmark|marked    |markdown-it|
|--------------------------|---------:|---------:|---------:|----------:|
|[README.md]               |         1|       3.6|       3.1|        3.9|
|[block-bq-flat.md]        |         1|       4.8|       4.9|        4.9|
|[block-bq-nested.md]      |         1|      11.9|       6.8|       10.7|
|[block-code.md]           |         1|       4.7|      12.1|       23.0|
|[block-fences.md]         |         1|       6.2|      21.2|       19.1|
|[block-heading.md]        |         1|       5.0|       4.8|        6.5|
|[block-hr.md]             |         1|       3.5|       3.3|        3.5|
|[block-html.md]           |         1|       2.1|       0.9|        3.8|
|[block-lheading.md]       |         1|       5.1|       4.9|        3.9|
|[block-list-flat.md]      |         1|       4.7|       4.4|        7.4|
|[block-list-nested.md]    |         1|       9.5|       7.8|       17.6|
|[block-ref-flat.md]       |         1|       0.8|       0.5|        0.6|
|[block-ref-nested.md]     |         1|       0.7|       0.6|        0.9|
|[inline-autolink.md]      |         1|       2.3|       3.4|        2.5|
|[inline-backticks.md]     |         1|       7.6|       5.3|        8.2|
|[inline-em-flat.md]       |         1|       1.5|       1.1|        1.6|
|[inline-em-nested.md]     |         1|       1.8|       1.3|        1.7|
|[inline-em-worst.md]      |         1|       2.4|       1.5|        2.5|
|[inline-entity.md]        |         1|       2.0|       3.8|        2.7|
|[inline-escape.md]        |         1|       2.2|       1.4|        5.0|
|[inline-html.md]          |         1|       2.9|       3.7|        3.3|
|[inline-links-flat.md]    |         1|       2.7|       2.7|        2.2|
|[inline-links-nested.md]  |         1|       1.4|       0.5|        0.5|
|[inline-newlines.md]      |         1|       2.3|       2.0|        3.5|
|[lorem1.md]               |         1|       6.0|       2.9|        3.3|
|[rawtabs.md]              |         1|       4.6|       3.9|        6.7|

[block-html.md]: bench/samples/block-html.md
[inline-links-nested.md]: bench/samples/inline-links-nested.md
[inline-em-flat.md]: bench/samples/inline-em-flat.md
[inline-autolink.md]: bench/samples/inline-autolink.md
[inline-html.md]: bench/samples/inline-html.md
[rawtabs.md]: bench/samples/rawtabs.md
[inline-escape.md]: bench/samples/inline-escape.md
[inline-em-worst.md]: bench/samples/inline-em-worst.md
[block-list-nested.md]: bench/samples/block-list-nested.md
[block-bq-nested.md]: bench/samples/block-bq-nested.md
[block-bq-flat.md]: bench/samples/block-bq-flat.md
[inline-newlines.md]: bench/samples/inline-newlines.md
[block-ref-nested.md]: bench/samples/block-ref-nested.md
[block-fences.md]: bench/samples/block-fences.md
[lorem1.md]: bench/samples/lorem1.md
[README.md]: bench/samples/README.md
[inline-links-flat.md]: bench/samples/inline-links-flat.md
[block-heading.md]: bench/samples/block-heading.md
[inline-em-nested.md]: bench/samples/inline-em-nested.md
[inline-entity.md]: bench/samples/inline-entity.md
[block-list-flat.md]: bench/samples/block-list-flat.md
[block-hr.md]: bench/samples/block-hr.md
[block-lheading.md]: bench/samples/block-lheading.md
[block-code.md]: bench/samples/block-code.md
[inline-backticks.md]: bench/samples/inline-backticks.md
[block-ref-flat.md]: bench/samples/block-ref-flat.md

To generate this table:

    make bench-detailed

Authors
-------

John MacFarlane wrote the first version of the JavaScript
implementation.  The block parsing algorithm was worked out together
with David Greenspan.  Kārlis Gaņģis helped work out a better parsing
algorithm for links and emphasis, eliminating several worst-case
performance issues.  Vitaly Puzrin has offered much good advice
about optimization and other issues.
