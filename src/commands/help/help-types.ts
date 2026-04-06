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
}
