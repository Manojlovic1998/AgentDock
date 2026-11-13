---
name: tsdoc-comments
description: Document TypeScript code with TSDoc comments. Use whenever writing, generating, refactoring or adding to TypeScript or TSX code (functions, classes, interfaces, types, React components, modules), even if the user doesn't mention comments or documentation.
allowed-tools: Read, Grep, Glob
---

# TSDoc comments

When you write TypeScript, document the code you create with TSDoc comments (`/** ... */`). The user wants code that arrives already documented, so they never have to ask for it as a follow-up. TSDoc is the standard that editors, TypeDoc and API Extractor all read, so a well-formed comment shows up in hover tooltips and generated docs for free.

## What to document

Document every declaration you create or substantially rewrite:

- Functions and methods, including each overload signature
- Classes, and their constructors, public methods and properties
- Interfaces and type aliases, and each of their members
- Enums and their members
- Exported constants and variables
- React components and their props interface (document each prop on the interface, not in the component comment)

Non-exported helpers get a comment too, but it can be a single summary line when the code is simple. Skip only what is truly self-evident and local, such as a loop variable or an inline callback.

Leave code you didn't touch alone. Adding comments across an existing file bloats the diff and hides the real change; do that only when the user asks for it.

## How to write a comment

Start with a summary sentence saying what the thing does or represents, from the caller's point of view. Then add only the tags that apply.

Write what the reader can't get from the signature: units, valid ranges, what happens on empty or missing input, side effects, why something exists. A comment that only restates the name ("Gets the user" on `getUser`) adds noise, so find the thing worth saying — what it returns when the user doesn't exist, where it looks them up, whether it caches.

Don't put types in comments. TypeScript already holds the types, and a copy in the comment will drift out of date. This is the main difference from JSDoc: write `@param id - The user's ID`, not `@param {string} id`.

## Tags

| Tag | Use it for |
|---|---|
| `@param name - Description` | Each parameter. The hyphen after the name is required by TSDoc. For a destructured object parameter, document the object's type instead. |
| `@typeParam T - Description` | Each generic type parameter |
| `@returns` | What is returned, when the function returns a value. Mention what a promise resolves to and special cases like `undefined` or an empty array. |
| `@throws` | Each error the caller should expect, and when. Name the type with a link: `@throws {@link NotFoundError} if no user has that ID` |
| `@remarks` | Longer detail that doesn't belong in the summary: algorithm notes, caveats, performance, usage guidance |
| `@example` | A short, realistic usage sample in a fenced `ts` code block. Add one for anything whose usage isn't obvious from the signature. |
| `@defaultValue` | The default of an optional property or option |
| `@deprecated` | What to use instead |
| `@see` | Related declarations or outside references |
| `{@link Name}` | Inline reference to another declaration |
| `@internal`, `@alpha`, `@beta`, `@public` | Release stage, only if the project already uses them |
| `@packageDocumentation` | A file-level comment describing the module, at the top of an entry-point file |
| `@inheritDoc` | Reuse documentation from a parent declaration instead of copying it |

Keep tags in this order: summary, `@remarks`, `@typeParam`, `@param`, `@returns`, `@throws`, `@example`, then the rest.

## Example

```ts
/**
 * Options for {@link fetchWithRetry}.
 */
export interface RetryOptions {
  /**
   * Maximum number of attempts, including the first one.
   *
   * @defaultValue 3
   */
  maxAttempts?: number;

  /**
   * Delay before the first retry, in milliseconds. Doubles after each failed attempt.
   *
   * @defaultValue 250
   */
  baseDelayMs?: number;
}

/**
 * Fetches a URL and parses the JSON body, retrying on network errors and 5xx responses.
 *
 * @remarks
 * 4xx responses are not retried, because repeating the same request will not fix them.
 *
 * @typeParam T - Shape of the parsed response body. Not validated at runtime.
 * @param url - Absolute URL to request.
 * @param options - Retry behaviour. Defaults are used for any omitted field.
 * @returns The parsed JSON body of the first successful response.
 * @throws {@link HttpError} if the server answers with a 4xx status, or still fails after the last attempt.
 *
 * @example
 * ```ts
 * const user = await fetchWithRetry<User>("https://api.example.com/users/42", {
 *   maxAttempts: 5,
 * });
 * ```
 */
export async function fetchWithRetry<T>(url: string, options: RetryOptions = {}): Promise<T> {
  // ...
}
```

## Fitting into an existing project

Before writing, glance at how nearby files are commented and match them. If the project has a `tsdoc.json`, its custom tags are available and its rules win. If the project enforces doc rules through lint (for example `eslint-plugin-tsdoc`), write comments that pass.

In plain JavaScript files there are no type annotations to rely on, so use JSDoc there (with `{type}` annotations) and keep the same habits: a summary line, what the signature can't say, an example where it helps.

When you change a function's behaviour, parameters or errors, update its comment in the same edit. A comment that describes the old behaviour is worse than none.
