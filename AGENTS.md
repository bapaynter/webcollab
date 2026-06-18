# AGENTS.md

## Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

---

## TypeScript Rules

### Explicit Type Annotations (MANDATORY)
- ALL function parameters MUST have explicit type annotations
- ALL function return types MUST be explicitly typed
- NO implicit any types allowed

### Avoid any (FORBIDDEN)
- any is FORBIDDEN — use unknown, union types, or generics instead

### Type Guards Over Assertions
- Use type guards (value is Type) for runtime type checking
- Only use as assertions when absolutely necessary, with a comment explaining why

### Strict Null Checks
- Handle null/undefined explicitly with early returns
- Use optional chaining (?.) and nullish coalescing (??)
- Define whether types can be null/undefined explicitly in interfaces (?: for optional, | null for nullable)

### Use satisfies for Type Validation
- Prefer satisfies over type annotation when you want to preserve literal types
- Prefer satisfies over as assertions when you want validation
- Use as const ONLY for object/array/tuple literals (not primitives or computed values)

### Utility Functions Type Safety (MANDATORY)
- ALL utility functions MUST be in .ts files
- ALL parameters MUST have explicit type annotations
- ALL return types MUST be explicitly defined

### tsconfig Requirements
```json
{
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true,
  "strictFunctionTypes": true,
  "strictPropertyInitialization": true,
  "noImplicitThis": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true
}
```

---

## Naming Conventions

| Category | Convention | Example |
|----------|------------|---------|
| Variables | camelCase | userName, totalPrice |
| Functions | camelCase (action-descriptive) | submitForm(), saveUserData() |
| Interfaces | PascalCase | UserProfile, ApiResponse\<T\> |
| Types | PascalCase | UserId, OrderStatus |
| Enums | PascalCase | PaymentMethod, UserRole |
| Constants | SCREAMING_SNAKE_CASE | MAX_RETRIES = 3 |

### Constants
- Top-level immutable constants: SCREAMING_SNAKE_CASE
- Boolean constants MUST start with IS_, HAS_, SHOULD_
- as const only for object/array/tuple literals — redundant on primitives, invalid on computed expressions
- Local const inside functions are NOT constants — use camelCase

### Function Naming
- Names describe WHAT the function does, not WHEN called
- AVOID handleClick(), onSubmit() — PREFER submitForm(), saveUserData()

### Object Properties
- Interface/type properties: camelCase
- Exception: API responses may use snake_case if that's the contract

---

## Code Style Rules

### Rule 0: Self-Documenting Code (FUNDAMENTAL)
- Variable names MUST clearly describe what they contain
- Function names MUST clearly describe what they do
- Use full words, not abbreviations (except id, url, api)
- Boolean variables: prefix with is, has, should
- If a comment explains WHAT the code does (not WHY), rename instead

### Rule 1: Early Return Pattern (MANDATORY)
- Check invalid/null/undefined at function start, return early
- Avoid wrapping entire code blocks in conditionals

### Rule 2: No Else After Return
- If a function returns in an if block, don't use else
- Keep code flat and linear

### Rule 3: Single Responsibility
- Each function does ONE thing
- Break multi-responsibility functions into smaller composed functions

### Rule 4: Composition Over Complex Conditionals
- Use small composable helper functions instead of nested if/else chains

### Rule 5: Array Methods Over Loops
- Prefer map, filter, reduce, find, some, every over for loops

### Rule 6: No Magic Numbers/Strings (MANDATORY)
- Define constants for numeric and string literals
- Name constants descriptively

### Rule 7: Consistent Error Handling
- Use try-catch for async operations
- Log errors with context: console.error('functionName: description', error)
- Never silently swallow errors
