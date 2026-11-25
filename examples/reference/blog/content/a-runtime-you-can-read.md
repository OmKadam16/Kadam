Pages that need state get **one generated module** with only the effects they
use, and keep working with JavaScript off.

1. The server HTML shows the starting state.
2. The script attaches to it.
3. A `noscript` stylesheet shows hidden content without JavaScript.
