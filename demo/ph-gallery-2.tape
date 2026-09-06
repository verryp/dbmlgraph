# Product Hunt gallery asset 2 — regenerate with: cd demo && vhs ph-gallery-2.tape
# Split from ph-gallery.tape: vhs 0.11.0 emits only the first Screenshot per tape.

Output ph-scratch-2.gif

Set FontSize 15
Set Width 1270
Set Height 760
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 16

Hide
Type `alias dbmlgraph="node ../dist/cli.js"; clear`
Enter
Type `dbmlgraph generate >/dev/null 2>&1; clear`
Enter
Show

Type "# the markdown your agent actually reads"
Enter
Type "cat graph/tables/orders.md"
Enter
Sleep 5s
Screenshot ph-gallery-2-query.png
