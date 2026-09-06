# Product Hunt gallery asset 1 — regenerate with: cd demo && vhs ph-gallery-1.tape
# Split from ph-gallery.tape: vhs 0.11.0 emits only the first Screenshot per tape.

Output ph-scratch-1.gif

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

Type "# one glob, every foreign key in the schema — with what each one means"
Enter
Type `dbmlgraph find "*_id"`
Enter
Sleep 4s
Screenshot ph-gallery-1-find.png
