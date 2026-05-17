/**
 * Tiny React component used to demonstrate the Vitest unit tier wiring for
 * component-level tests. Renders a greeting with a configurable name.
 *
 * Shipped solely as a teaching artifact — production code does not import it.
 */
export interface GreetingProps {
  readonly name: string;
}

export function Greeting({ name }: GreetingProps) {
  return <p data-testid="greeting">{`Hello, ${name}!`}</p>;
}
