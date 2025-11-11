import type { Stack } from "../../core/indexer/stack-detector.js";

// Stack-specific security guidance
const SECURITY_PROMPTS: Record<Stack, string> = {
  nodejs: `
## Node.js/TypeScript Security Considerations

Pay special attention to:

1. **Environment Variable Exposure**
   - Check for accidental logging of process.env or sensitive config
   - Verify .env files are properly gitignored
   - Look for hardcoded secrets or API keys

2. **Prototype Pollution**
   - Flag unsafe object merging (Object.assign, spread with user input)
   - Check for lodash vulnerabilities (merge, set, defaultsDeep)
   - Verify JSON.parse input validation

3. **Code Injection**
   - Never use eval(), Function() constructor, or vm.runInNewContext() with user input
   - Flag template literal injection risks
   - Check for command injection in child_process.exec()

4. **Dependency Vulnerabilities**
   - Flag outdated or vulnerable packages
   - Check for typosquatting in package names
   - Verify integrity checks (package-lock.json)

5. **Authentication & Sessions**
   - Verify JWT secrets are strong and env-based
   - Check session cookie flags (httpOnly, secure, sameSite)
   - Look for weak password validation

6. **Next.js Specific**
   - Check API routes for proper authentication
   - Verify getServerSideProps doesn't leak sensitive data
   - Review middleware for security headers

7. **React Specific**
   - Flag dangerouslySetInnerHTML without sanitization
   - Check for XSS in user-generated content
   - Verify proper CSRF protection in forms`,

  python: `
## Python Security Considerations

Pay special attention to:

1. **Code Injection**
   - Never use eval() or exec() with user input
   - Flag compile() with untrusted code
   - Check for command injection in os.system(), subprocess.shell=True

2. **Serialization Vulnerabilities**
   - Flag pickle.loads() with untrusted data (arbitrary code execution)
   - Check for yaml.load() instead of yaml.safe_load()
   - Verify JSON parsing doesn't execute code

3. **SQL Injection**
   - Flag string concatenation in SQL queries
   - Verify ORM usage (SQLAlchemy) uses parameters
   - Check for raw queries without proper escaping

4. **Path Traversal**
   - Verify file operations validate/sanitize paths
   - Check for os.path.join() with user input without validation
   - Flag open() with unsanitized filenames

5. **Cryptography**
   - Flag weak algorithms (MD5, SHA1 for passwords)
   - Verify use of secrets module for tokens, not random
   - Check for hardcoded cryptographic keys

6. **Authentication**
   - Verify password hashing uses bcrypt/argon2/scrypt
   - Check for timing attack vulnerabilities
   - Flag weak session management

7. **Django/Flask Specific**
   - Verify CSRF protection is enabled
   - Check for SQL injection in raw queries
   - Review template auto-escaping settings`,

  rust: `
## Rust Security Considerations

Pay special attention to:

1. **Unsafe Code Blocks**
   - Verify unsafe blocks are justified and documented
   - Check for proper invariant maintenance
   - Flag unnecessary use of unsafe

2. **FFI Boundaries**
   - Verify C interop properly handles null pointers
   - Check for buffer overflows in FFI calls
   - Review string conversions (CString, CStr) for safety

3. **Memory Safety**
   - Even in unsafe: verify no use-after-free
   - Check for data races in unsafe concurrent code
   - Review raw pointer dereferences

4. **Integer Overflow**
   - In unsafe or critical paths, check for overflow
   - Verify wrapping/saturating operations where appropriate
   - Flag unchecked arithmetic in security-sensitive code

5. **Input Validation**
   - Verify external input is validated before use
   - Check parser combinators handle malicious input
   - Review deserialization code (serde) for DoS risks

6. **Cryptography**
   - Verify use of audited crypto libraries (ring, rustls)
   - Flag custom crypto implementations
   - Check for proper key management

7. **Concurrency**
   - Even with Rust's safety: review lock ordering
   - Check for logical races despite memory safety
   - Verify channel usage doesn't cause deadlocks`,

  go: `
## Go Security Considerations

Pay special attention to:

1. **SQL Injection**
   - Flag string concatenation in SQL queries
   - Verify database/sql uses parameterized queries
   - Check for unsafe query building

2. **Command Injection**
   - Review exec.Command() usage with user input
   - Verify proper argument escaping
   - Flag shell invocations with unsanitized input

3. **Path Traversal**
   - Check filepath.Join() with user input for validation
   - Verify path cleaning (filepath.Clean)
   - Flag directory traversal vulnerabilities

4. **Goroutine & Channel Safety**
   - Check for goroutine leaks (unbounded spawning)
   - Verify proper context cancellation
   - Review channel closing for panics

5. **Error Handling**
   - Verify errors expose appropriate information only
   - Flag error messages with sensitive data
   - Check for ignored critical errors

6. **Cryptography**
   - Flag weak crypto (MD5, SHA1 for passwords)
   - Verify use of crypto/rand not math/rand for secrets
   - Check for proper TLS configuration

7. **Type Assertions & Reflection**
   - Verify type assertions handle failures
   - Check reflection usage for safety
   - Flag panic risks in type conversions`,

  java: `
## Java Security Considerations

Pay special attention to:

1. **SQL Injection**
   - Flag string concatenation in SQL
   - Verify PreparedStatement usage
   - Check for unsafe query construction

2. **Serialization**
   - Flag unsafe deserialization
   - Check for ObjectInputStream with untrusted data
   - Verify serialization filters

3. **Authentication & Authorization**
   - Check session management
   - Verify proper access controls
   - Review JWT handling

4. **Input Validation**
   - Verify user input is validated
   - Check for XSS vulnerabilities
   - Review file upload handling`,

  general: "",
};

// Stack-specific performance guidance
const PERFORMANCE_PROMPTS: Record<Stack, string> = {
  nodejs: `
## Node.js/TypeScript Performance Considerations

Pay special attention to:

1. **Event Loop Blocking**
   - Flag synchronous operations in async contexts (fs.readFileSync)
   - Check for CPU-intensive work without worker threads
   - Verify large loops don't block the event loop

2. **Promise & Async Patterns**
   - Flag missing await keywords
   - Check for Promise constructor anti-pattern
   - Verify Promise.all() for concurrent operations

3. **Memory Management**
   - Check for memory leaks (event listener cleanup)
   - Flag large object retention in closures
   - Verify stream usage for large data

4. **Array vs Stream Operations**
   - Suggest streams for large datasets
   - Flag inefficient array operations (.map().filter().map())
   - Check for unnecessary array copies

5. **Database Queries**
   - Flag N+1 query problems
   - Check for missing indexes in queries
   - Verify connection pooling

6. **Next.js Specific**
   - Verify proper use of getStaticProps vs getServerSideProps
   - Check for unnecessary client-side data fetching
   - Review bundle size and code splitting

7. **React Specific**
   - Flag missing useMemo/useCallback for expensive computations
   - Check for unnecessary re-renders
   - Verify proper key usage in lists`,

  python: `
## Python Performance Considerations

Pay special attention to:

1. **List Comprehensions vs Loops**
   - Suggest list comprehensions over explicit loops
   - Recommend generator expressions for large datasets
   - Flag unnecessary list() conversions

2. **Global Interpreter Lock (GIL)**
   - Suggest multiprocessing for CPU-bound tasks
   - Verify asyncio for I/O-bound operations
   - Flag thread usage for CPU-intensive work

3. **Data Structure Choice**
   - Suggest sets for membership testing
   - Recommend deque for queue operations
   - Flag inefficient list operations (repeated .append + .pop(0))

4. **String Operations**
   - Suggest ''.join() over repeated concatenation
   - Recommend f-strings over format() or %
   - Flag inefficient string building in loops

5. **Function Call Overhead**
   - Flag excessive function calls in tight loops
   - Suggest inlining for performance-critical code
   - Check for unnecessary lambda usage

6. **Database & ORM**
   - Flag N+1 queries in Django/SQLAlchemy
   - Verify proper use of select_related/prefetch_related
   - Check for missing database indexes

7. **NumPy/Pandas Specific**
   - Suggest vectorized operations over loops
   - Flag iterrows() usage (prefer itertuples/apply)
   - Check for unnecessary data copying`,

  rust: `
## Rust Performance Considerations

Pay special attention to:

1. **Zero-Cost Abstractions**
   - Verify iterator chains are optimized
   - Check for unnecessary collect() calls
   - Suggest iterator methods over manual loops

2. **Clone & Copy Overhead**
   - Flag unnecessary .clone() calls
   - Suggest references where appropriate
   - Check for excessive copying in hot paths

3. **Allocation Patterns**
   - Flag repeated allocations in loops
   - Suggest Vec::with_capacity() for known sizes
   - Check for unnecessary heap allocations

4. **String Operations**
   - Suggest &str over String where possible
   - Flag repeated String allocations
   - Check for efficient string building (format! vs push_str)

5. **Async Performance**
   - Verify efficient future composition
   - Check for blocking operations in async contexts
   - Flag excessive task spawning

6. **Compiler Hints**
   - Suggest #[inline] for small hot functions
   - Check for optimization barriers
   - Verify likely/unlikely branches marked

7. **Data Structure Choice**
   - Suggest BTreeMap vs HashMap based on use case
   - Check for efficient container usage
   - Flag linear scans where hash lookups appropriate`,

  go: `
## Go Performance Considerations

Pay special attention to:

1. **Goroutine Management**
   - Flag excessive goroutine creation
   - Verify worker pool patterns for bounded concurrency
   - Check for goroutine leaks

2. **Channel Buffering**
   - Suggest appropriate buffer sizes
   - Flag unbuffered channels in high-throughput code
   - Check for channel blocking issues

3. **Memory Allocation**
   - Flag allocations in hot paths
   - Suggest sync.Pool for frequent allocations
   - Check for unnecessary pointer usage

4. **Slice Operations**
   - Suggest make() with capacity for known sizes
   - Flag repeated append() without pre-allocation
   - Check for slice growth patterns

5. **String Building**
   - Suggest strings.Builder over concatenation
   - Flag repeated string concatenation in loops
   - Check for efficient string operations

6. **Interface Overhead**
   - Flag excessive interface conversions
   - Check for unnecessary boxing
   - Verify type assertion efficiency

7. **Defer Performance**
   - Flag defer in tight loops (consider manual cleanup)
   - Check for defer overhead in hot paths
   - Verify appropriate defer usage`,

  java: `
## Java Performance Considerations

Pay special attention to:

1. **Object Allocation**
   - Flag excessive object creation
   - Suggest object pooling where appropriate
   - Check for autoboxing overhead

2. **Collection Choice**
   - Verify appropriate collection types
   - Check for sizing hints
   - Flag inefficient operations

3. **Stream Operations**
   - Check for parallel stream misuse
   - Verify efficient stream pipelines
   - Flag unnecessary boxing

4. **Concurrency**
   - Review thread pool configuration
   - Check for contention issues
   - Verify efficient synchronization`,

  general: "",
};

// Stack-specific logic guidance
const LOGIC_PROMPTS: Record<Stack, string> = {
  nodejs: `
## Node.js/TypeScript Logic Considerations

Pay special attention to:

1. **Async/Await Patterns**
   - Flag missing await keywords before async calls
   - Check for floating promises (unawaited)
   - Verify error handling in async functions

2. **TypeScript Type Safety**
   - Flag any types without justification
   - Check for missing null/undefined checks
   - Verify proper type narrowing

3. **Null/Undefined Handling**
   - Flag potential null/undefined access
   - Suggest optional chaining (?.)
   - Check for proper default values

4. **Error Handling**
   - Verify try/catch around async operations
   - Check for error swallowing
   - Flag missing error propagation

5. **Edge Cases**
   - Check array operations for empty arrays
   - Verify division by zero checks
   - Flag missing boundary validations

6. **React Hooks**
   - Verify dependency arrays are complete
   - Check for stale closure issues
   - Flag effect cleanup missing

7. **Conditional Logic**
   - Flag complex nested conditionals
   - Suggest early returns
   - Check for unreachable code`,

  python: `
## Python Logic Considerations

Pay special attention to:

1. **None Handling**
   - Flag potential None access without checks
   - Distinguish between None, [], {}, "", 0 in conditionals
   - Verify proper None vs falsy checks

2. **Mutable Default Arguments**
   - Flag mutable defaults ([], {}) in function signatures
   - Suggest None with conditional initialization
   - Check for shared state bugs

3. **Exception Handling**
   - Flag bare except: clauses
   - Verify specific exception catching
   - Check for proper finally cleanup

4. **Type Checking**
   - Verify isinstance() over type() ==
   - Check for duck typing assumptions
   - Flag potential AttributeError

5. **Iteration Edge Cases**
   - Check for modifying list during iteration
   - Verify generator exhaustion awareness
   - Flag potential StopIteration issues

6. **Scope & Closures**
   - Check for late binding closure issues
   - Verify nonlocal/global usage
   - Flag variable shadowing

7. **Boolean Evaluation**
   - Distinguish between is None and == None
   - Check for truthiness assumptions
   - Verify proper boolean expressions`,

  rust: `
## Rust Logic Considerations

Pay special attention to:

1. **Option & Result Handling**
   - Flag unwrap() in production code
   - Suggest ? operator or proper pattern matching
   - Check for expect() with meaningful messages

2. **Ownership & Borrowing**
   - Verify borrow checker is not being fought unnecessarily
   - Check for logical issues despite compile-time safety
   - Flag complex lifetime workarounds

3. **Pattern Matching**
   - Verify match exhaustiveness
   - Check for _ catch-all hiding logic bugs
   - Flag partial pattern matches

4. **Integer Edge Cases**
   - Check for overflow in arithmetic
   - Verify wrapping/saturating/checked operations
   - Flag potential panic in debug mode

5. **Iterator Consumption**
   - Verify iterators are fully consumed where expected
   - Check for early termination issues
   - Flag iterator adapter chains correctness

6. **Error Propagation**
   - Verify proper error context
   - Check for information loss in error conversions
   - Flag error type mismatches

7. **Logic Invariants**
   - Check for documented invariants being maintained
   - Verify state machine correctness
   - Flag potential logic races despite memory safety`,

  go: `
## Go Logic Considerations

Pay special attention to:

1. **Error Handling**
   - Flag ignored errors (err != nil checks)
   - Verify error wrapping with context
   - Check for proper error propagation

2. **Nil Pointer Dereference**
   - Flag potential nil access without checks
   - Verify nil checks before dereference
   - Check for nil interface values

3. **Range Loop Variables**
   - Flag closure over loop variable (common bug)
   - Check for pointer to loop variable
   - Verify goroutine usage with loop vars

4. **Channel Operations**
   - Check for deadlocks (channel blocking)
   - Verify select statement completeness
   - Flag potential panic on closed channel send

5. **Defer Execution Order**
   - Verify defer behavior in loops
   - Check for defer argument evaluation timing
   - Flag return value modification in defer

6. **Type Assertions**
   - Verify two-value form for safety (v, ok := x.(Type))
   - Flag panic-risk single-value assertions
   - Check for interface nil vs concrete nil

7. **Slice/Map Operations**
   - Check for concurrent map access without sync
   - Verify slice capacity vs length understanding
   - Flag potential slice reference bugs`,

  java: `
## Java Logic Considerations

Pay special attention to:

1. **Null Pointer Exceptions**
   - Flag potential null dereference
   - Verify null checks
   - Suggest Optional usage

2. **Exception Handling**
   - Check for proper try-catch
   - Verify resource cleanup
   - Flag error swallowing

3. **Collection Operations**
   - Verify iteration safety
   - Check for concurrent modification
   - Flag index out of bounds

4. **Threading Issues**
   - Check for race conditions
   - Verify proper synchronization
   - Flag deadlock potential`,

  general: "",
};

/**
 * Get stack-specific instructions for an agent type
 */
export function getStackSpecificInstructions(
  agentType: "security" | "performance" | "logic",
  stacks: Stack[]
): string {
  const promptMap = {
    security: SECURITY_PROMPTS,
    performance: PERFORMANCE_PROMPTS,
    logic: LOGIC_PROMPTS,
  };

  const prompts = promptMap[agentType];

  // Filter out 'general' and get unique stack-specific prompts
  const stackInstructions = stacks
    .filter((stack) => stack !== "general")
    .map((stack) => prompts[stack])
    .filter((prompt) => prompt.trim().length > 0);

  if (stackInstructions.length === 0) {
    return "";
  }

  return `\n\n# Stack-Specific Analysis\n\n${stackInstructions.join("\n\n")}`;
}
