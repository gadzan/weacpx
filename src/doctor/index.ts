import { runDoctor } from "./doctor";
import type { DoctorRunOptions } from "./doctor-types";

interface MainDeps {
  runDoctor?: typeof runDoctor;
  print?: (line: string) => void;
}

export async function main(options: DoctorRunOptions, deps: MainDeps = {}): Promise<number> {
  const result = await (deps.runDoctor ?? runDoctor)(options);
  const print = deps.print ?? ((line: string) => console.log(line));

  for (const line of result.output) {
    print(line);
  }

  return result.exitCode;
}
