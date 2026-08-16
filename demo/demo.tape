# vhs demo tape — regenerate with: cd demo && vhs demo.tape
# Requires: vhs (brew install vhs), dbmlgraph built at ../dist/cli.js

Output demo.gif

Set FontSize 15
Set Width 1100
Set Height 620
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 16

Hide
Type `alias dbmlgraph="node ../dist/cli.js"; clear`
Enter
Show

Type "# DBML schema + business-context overlay -> LLM-ready knowledge graph"
Enter
Sleep 800ms

Type "dbmlgraph generate"
Enter
Sleep 2s

Type "# where does promo_id live?"
Enter
Type "dbmlgraph find promo_id"
Enter
Sleep 3.5s

Type "# full context for one table: columns, meanings, relationships"
Enter
Type "dbmlgraph query orders | head -30"
Enter
Sleep 5s

Type "# wire it into your AI agent"
Enter
Type "dbmlgraph install claude"
Enter
Sleep 3s
