---
title: Multi-fence schema note
---

# Multi-fence schema note

First part of the schema:

```dbml
Table widgets {
  id bigint [pk]
  name varchar(50) [not null]
}
```

Some prose in between blocks.

```dbml
Table gadgets {
  id bigint [pk]
  widget_id bigint [ref: > widgets.id]
}
```

Done.
