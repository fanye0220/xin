export interface TavernCardV2 {
  spec: 'chara_card_v2' | 'chara_card_v3';
  spec_version: '2.0' | '3.0';
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
    source?: string;
    alternate_greetings: string[];
    extensions: Record<string, any>;
    character_book?: any;
  };
}

export function parseTavernCard(rawData: any): TavernCardV2 {
  if (!rawData || typeof rawData !== 'object') {
    return {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        tags: [],
        creator: '',
        character_version: '',
        alternate_greetings: [],
        extensions: {},
      },
    };
  }

  // Support deeply nested or wrapped data (e.g. rawData.data.data or rawData.data or rawData)
  const innerData = rawData.data?.data && typeof rawData.data.data === 'object'
    ? rawData.data.data
    : rawData.data && typeof rawData.data === 'object' && !Array.isArray(rawData.data)
      ? rawData.data
      : rawData;

  const isV3 = rawData.spec === 'chara_card_v3' || innerData.spec === 'chara_card_v3';

  // Robust extraction of character_book / world_info across V1, V2, V3, and Tavern extension specs
  const characterBook =
    innerData.character_book ||
    rawData.character_book ||
    innerData.extensions?.character_book ||
    rawData.extensions?.character_book ||
    innerData.data?.character_book ||
    rawData.data?.character_book ||
    innerData.world_info ||
    rawData.world_info ||
    innerData.extensions?.world_info ||
    rawData.extensions?.world_info ||
    (rawData.entries ? rawData : undefined) ||
    (innerData.entries ? innerData : undefined);

  // Extract alternate greetings reliably (support array of strings or objects)
  let rawAlt =
    innerData.alternate_greetings ||
    rawData.alternate_greetings ||
    innerData.extensions?.alternate_greetings ||
    rawData.extensions?.alternate_greetings ||
    innerData.other_greetings ||
    rawData.other_greetings ||
    [];

  if (!Array.isArray(rawAlt)) {
    rawAlt = typeof rawAlt === 'string' && rawAlt.trim() ? [rawAlt] : [];
  }
  const alternateGreetings = rawAlt
    .map((item: any) => (typeof item === 'string' ? item : item?.message || item?.text || item?.content || ''))
    .filter((s: string) => typeof s === 'string' && s.length > 0);

  // Extract tags reliably
  let rawTags =
    innerData.tags ||
    rawData.tags ||
    innerData.categories ||
    rawData.categories ||
    [];
  if (typeof rawTags === 'string') {
    rawTags = rawTags.split(',').map((t: string) => t.trim()).filter(Boolean);
  }
  const tags = Array.isArray(rawTags) ? rawTags.map(String).filter(Boolean) : [];

  const name =
    innerData.name ||
    rawData.name ||
    innerData.char_name ||
    rawData.char_name ||
    innerData.character_name ||
    rawData.character_name ||
    innerData.title ||
    rawData.title ||
    '';

  const description =
    innerData.description ||
    rawData.description ||
    innerData.char_persona ||
    rawData.char_persona ||
    innerData.persona ||
    rawData.persona ||
    '';

  const personality =
    innerData.personality ||
    rawData.personality ||
    innerData.personality_summary ||
    rawData.personality_summary ||
    '';

  const scenario =
    innerData.scenario ||
    rawData.scenario ||
    innerData.world_scenario ||
    rawData.world_scenario ||
    '';

  const firstMes =
    innerData.first_mes ||
    rawData.first_mes ||
    innerData.char_greeting ||
    rawData.char_greeting ||
    innerData.greeting ||
    rawData.greeting ||
    innerData.first_message ||
    rawData.first_message ||
    '';

  const mesExample =
    innerData.mes_example ||
    rawData.mes_example ||
    innerData.example_dialogue ||
    rawData.example_dialogue ||
    innerData.dialogue_examples ||
    rawData.dialogue_examples ||
    '';

  const creatorNotes =
    innerData.creator_notes ||
    rawData.creator_notes ||
    innerData.creatorcomment ||
    rawData.creatorcomment ||
    innerData.creator_comment ||
    rawData.creator_comment ||
    innerData.comment ||
    rawData.comment ||
    '';

  const systemPrompt =
    innerData.system_prompt ||
    rawData.system_prompt ||
    innerData.main_prompt ||
    rawData.main_prompt ||
    '';

  const postHistoryInstructions =
    innerData.post_history_instructions ||
    rawData.post_history_instructions ||
    innerData.jailbreak ||
    rawData.jailbreak ||
    '';

  const creator =
    innerData.creator ||
    rawData.creator ||
    innerData.author ||
    rawData.author ||
    '';

  const characterVersion =
    innerData.character_version ||
    rawData.character_version ||
    innerData.version ||
    rawData.version ||
    '';

  const source =
    innerData.source ||
    rawData.source ||
    innerData.extensions?.source ||
    rawData.extensions?.source ||
    '';

  const extensions =
    innerData.extensions ||
    rawData.extensions ||
    {};

  return {
    spec: isV3 ? 'chara_card_v3' : 'chara_card_v2',
    spec_version: isV3 ? '3.0' : '2.0',
    data: {
      name,
      description,
      personality,
      scenario,
      first_mes: firstMes,
      mes_example: mesExample,
      creator_notes: creatorNotes,
      system_prompt: systemPrompt,
      post_history_instructions: postHistoryInstructions,
      tags,
      creator,
      character_version: characterVersion,
      source,
      alternate_greetings: alternateGreetings,
      extensions,
      character_book: characterBook,
    },
  };
}
