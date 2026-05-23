export interface HelpCommandEntry {
  usage: string;
  description: string;
}

export interface HelpTopicMetadata {
  topic: string;
  aliases: string[];
  summary: string;
  commands: HelpCommandEntry[];
  examples?: string[];
  // Free-form constraints/caveats shown under a 说明 section in `/help <topic>`.
  notes?: string[];
}
