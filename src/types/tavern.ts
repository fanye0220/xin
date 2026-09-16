export interface TavernCardV2 {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    creator_notes: string;
    system_prompt: string;
    post_history_instructions: string;
    tags: string[];
    creator: string;
    character_version: string;
    alternate_greetings: string[];
    extensions: Record<string, any>;
  };
}

export function parseTavernCard(rawData: any): any {
  const data = rawData.data || rawData;
  const isV3 = rawData.spec === 'chara_card_v3';

  return {
    spec: isV3 ? 'chara_card_v3' : 'chara_card_v2',
    spec_version: isV3 ? '3.0' : '2.0',
    data: {
      name: data.name || rawData.name || '',
      description: data.description || rawData.description || '',
      personality: data.personality || rawData.personality || '',
      scenario: data.scenario || rawData.scenario || '',
      first_mes: data.first_mes || rawData.first_mes || '',
      mes_example: data.mes_example || rawData.mes_example || '',
      creator_notes: data.creator_notes || rawData.creatorcomment || '',
      system_prompt: data.system_prompt || rawData.system_prompt || '',
      post_history_instructions: data.post_history_instructions || rawData.post_history_instructions || '',
      tags: data.tags || rawData.tags || [],
      creator: data.creator || rawData.creator || '',
      character_version: data.character_version || rawData.character_version || '',
      alternate_greetings: data.alternate_greetings || rawData.alternate_greetings || [],
      extensions: data.extensions || rawData.extensions || {},
      character_book: data.character_book || rawData.character_book || undefined,
    }
  };
}
