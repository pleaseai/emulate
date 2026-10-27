export class JqlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JqlError'
  }
}

// Tokens

type TokenType = 'word' | 'string' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof'

interface Token {
  type: TokenType
  value: string
  pos: number
}

const OPERATORS = ['!=', '!~', '>=', '<=', '=', '~', '>', '<']
const WORD_BREAK = /[\s()=,!~<>"']/

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch, pos: i++ })
    }
    else if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch, pos: i++ })
    }
    else if (ch === ',') {
      tokens.push({ type: 'comma', value: ch, pos: i++ })
    }
    else if (ch === '"' || ch === '\'') {
      const start = i++
      let value = ''
      let closed = false
      while (i < input.length) {
        const c = input[i]
        if (c === '\\' && i + 1 < input.length) {
          value += input[i + 1]
          i += 2
          continue
        }
        if (c === ch) {
          closed = true
          i++
          break
        }
        value += c
        i++
      }
      if (!closed) {
        throw new JqlError(
          `Error in the JQL Query: The quoted string '${value}' has not been completed. (line 1, character ${start + 1})`,
        )
      }
      tokens.push({ type: 'string', value, pos: start })
    }
    else {
      const op = OPERATORS.find(candidate => input.startsWith(candidate, i))
      if (op) {
        tokens.push({ type: 'op', value: op, pos: i })
        i += op.length
        continue
      }
      if (ch === '!') {
        throw new JqlError(
          `Error in the JQL Query: The character '!' is a reserved JQL character. (line 1, character ${i + 1})`,
        )
      }
      const start = i
      while (i < input.length && !WORD_BREAK.test(input[i])) {
        i++
      }
      tokens.push({ type: 'word', value: input.slice(start, i), pos: start })
    }
  }
  tokens.push({ type: 'eof', value: '', pos: input.length })
  return tokens
}

// AST

export type Operand
  = | { kind: 'value', value: string }
    | { kind: 'fn', name: string, args: string[] }
    | { kind: 'empty' }

export type JqlNode
  = | { type: 'and' | 'or', left: JqlNode, right: JqlNode }
    | { type: 'not', expr: JqlNode }
    | { type: 'clause', field: string, op: string, operands: Operand[], listFn?: Operand }

export interface OrderBy {
  field: string
  direction: 'ASC' | 'DESC'
}

export interface JqlQuery {
  where: JqlNode | null
  orderBy: OrderBy[]
}

const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'empty', 'null', 'order', 'by', 'asc', 'desc'])

class Parser {
  private index = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.index]
  }

  private next(): Token {
    return this.tokens[this.index++]
  }

  private isKeyword(word: string, token = this.peek()): boolean {
    return token.type === 'word' && token.value.toLowerCase() === word
  }

  private fail(expecting: string): never {
    const token = this.peek()
    const got = token.type === 'eof' ? 'end of query' : `'${token.value}'`
    throw new JqlError(
      `Error in the JQL Query: Expecting ${expecting} but got ${got}. (line 1, character ${token.pos + 1})`,
    )
  }

  parse(): JqlQuery {
    let where: JqlNode | null = null
    if (this.peek().type !== 'eof' && !this.isKeyword('order')) {
      where = this.parseOr()
    }
    const orderBy: OrderBy[] = []
    if (this.isKeyword('order')) {
      this.next()
      if (!this.isKeyword('by')) {
        this.fail('\'by\'')
      }
      this.next()
      do {
        const token = this.peek()
        if (token.type !== 'word' && token.type !== 'string') {
          this.fail('a field name')
        }
        this.next()
        let direction: 'ASC' | 'DESC' = 'ASC'
        if (this.isKeyword('asc') || this.isKeyword('desc')) {
          direction = this.next().value.toUpperCase() as 'ASC' | 'DESC'
        }
        orderBy.push({ field: token.value, direction })
      } while (this.peek().type === 'comma' && this.next())
    }
    if (this.peek().type !== 'eof') {
      this.fail('either \'OR\' or \'AND\'')
    }
    return { where, orderBy }
  }

  private parseOr(): JqlNode {
    let left = this.parseAnd()
    while (this.isKeyword('or')) {
      this.next()
      left = { type: 'or', left, right: this.parseAnd() }
    }
    return left
  }

  private parseAnd(): JqlNode {
    let left = this.parseNot()
    while (this.isKeyword('and')) {
      this.next()
      left = { type: 'and', left, right: this.parseNot() }
    }
    return left
  }

  private parseNot(): JqlNode {
    if (this.isKeyword('not')) {
      this.next()
      return { type: 'not', expr: this.parseNot() }
    }
    if (this.peek().type === 'lparen') {
      this.next()
      const expr = this.parseOr()
      if (this.peek().type !== 'rparen') {
        this.fail('\')\'')
      }
      this.next()
      return expr
    }
    return this.parseClause()
  }

  private parseClause(): JqlNode {
    const fieldToken = this.peek()
    if (
      (fieldToken.type !== 'word' && fieldToken.type !== 'string')
      || (fieldToken.type === 'word' && KEYWORDS.has(fieldToken.value.toLowerCase()))
    ) {
      this.fail('a field name')
    }
    this.next()
    const field = fieldToken.value
    const token = this.peek()

    if (token.type === 'op') {
      this.next()
      return { type: 'clause', field, op: token.value, operands: [this.parseOperand()] }
    }
    if (this.isKeyword('is')) {
      this.next()
      let op = 'is'
      if (this.isKeyword('not')) {
        this.next()
        op = 'is not'
      }
      if (!this.isKeyword('empty') && !this.isKeyword('null')) {
        this.fail('\'EMPTY\' or \'NULL\'')
      }
      this.next()
      return { type: 'clause', field, op, operands: [{ kind: 'empty' }] }
    }
    let op = 'in'
    if (this.isKeyword('not')) {
      this.next()
      op = 'not in'
      if (!this.isKeyword('in')) {
        this.fail('\'IN\'')
      }
    }
    if (this.isKeyword('in')) {
      this.next()
      if (this.peek().type === 'lparen') {
        this.next()
        const operands: Operand[] = []
        if (this.peek().type !== 'rparen') {
          operands.push(this.parseOperand())
          while (this.peek().type === 'comma') {
            this.next()
            operands.push(this.parseOperand())
          }
        }
        if (this.peek().type !== 'rparen') {
          this.fail('\')\'')
        }
        this.next()
        return { type: 'clause', field, op, operands }
      }
      const fn = this.parseOperand()
      if (fn.kind !== 'fn') {
        this.fail('a list or function')
      }
      return { type: 'clause', field, op, operands: [], listFn: fn }
    }
    return this.fail('operator')
  }

  private parseOperand(): Operand {
    const token = this.peek()
    if (token.type === 'string') {
      this.next()
      return { kind: 'value', value: token.value }
    }
    if (token.type !== 'word' || ['and', 'or', 'order', 'in', 'is', 'not'].includes(token.value.toLowerCase())) {
      this.fail('either a value, list or function')
    }
    this.next()
    const lower = token.value.toLowerCase()
    if (lower === 'empty' || lower === 'null') {
      return { kind: 'empty' }
    }
    if (this.peek().type === 'lparen') {
      this.next()
      const args: string[] = []
      while (this.peek().type !== 'rparen') {
        const arg = this.peek()
        if (arg.type !== 'word' && arg.type !== 'string') {
          this.fail('a function argument')
        }
        args.push(this.next().value)
        if (this.peek().type === 'comma') {
          this.next()
        }
        else if (this.peek().type !== 'rparen') {
          this.fail('\')\'')
        }
      }
      this.next()
      return { kind: 'fn', name: token.value, args }
    }
    return { kind: 'value', value: token.value }
  }
}

export function parseJql(jql: string): JqlQuery {
  return new Parser(tokenize(jql ?? '')).parse()
}
