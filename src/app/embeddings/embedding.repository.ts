import { query } from '../utils/database';

interface EmbeddingData {
  userId: string;
  sourceType: string;
  sourceId: string;
  content: string;
  embedding: number[];
}

export const batchInsertEmbeddings = async (embeddings: EmbeddingData[]) => {
  if (embeddings.length === 0) {
    return;
  }

  const values = embeddings.map(e => [
    e.userId,
    e.sourceType,
    e.sourceId,
    e.content,
    `[${e.embedding.join(',')}]`, // pgvector format
  ]);

  const text = `
    INSERT INTO embeddings (user_id, source_type, source_id, content, embedding)
    SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::uuid[], $4::text[], $5::vector[])
    ON CONFLICT (user_id, source_type, source_id) DO UPDATE SET
      content = EXCLUDED.content,
      embedding = EXCLUDED.embedding
  `;

  // pg-node does not support array of arrays directly, need to format it.
  const formattedValues = values[0].map((_, colIndex) =>
    values.map(row => row[colIndex])
  );

  await query(text, formattedValues);
};

export interface SearchResult {
  content: string;
  similarity: number;
}

export const searchEmbeddings = async (
  userId: string,
  embedding: number[],
  limit: number,
  offset = 0,
  sourceType?: string
): Promise<SearchResult[]> => {
  const embeddingString = `[${embedding.join(',')}]`;
  const queryParams: (string | number)[] = [
    userId,
    embeddingString,
    limit,
    offset,
  ];
  const whereClauses = ['user_id = $1'];

  if (sourceType) {
    queryParams.push(sourceType);
    whereClauses.push(`source_type = $${queryParams.length}`);
  }

  const text = `
    SELECT
      content,
      1 - (embedding <=> $2::vector) AS similarity
    FROM embeddings
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY similarity DESC
    LIMIT $3
    OFFSET $4
  `;

  const { rows } = await query(text, queryParams);
  return rows as SearchResult[];
};
