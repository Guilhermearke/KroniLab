-- Migration 0002: Model Registry para rastreabilidade dos modelos de IA.
--
-- Cada versão do Kroni Separation Engine fica registrada aqui.
-- Toda música processada guarda qual modelo foi usado (model_id + model_version)
-- para poder oferecer "reprocessar com modelo melhor" no futuro.

-- Tabela de modelos de IA
CREATE TABLE IF NOT EXISTS ai_models (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,  -- 'kroni-separation-base', 'kroni-worship-v1'
  family       text NOT NULL,         -- 'bs_roformer', 'mel_band_roformer'
  version      text NOT NULL,         -- '1.0.0', semver
  -- Stems que este modelo entrega: '{vocals,drums,bass,other}'
  stem_schema  text[] NOT NULL,
  -- Caminho/URL do checkpoint (informativo, não exposto na API pública)
  checkpoint   text,
  -- Config MSST serializada como JSON
  config       jsonb,
  -- Apenas um modelo ativo por família por vez (o que o pipeline usa)
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- RLS: só admins podem criar/alterar modelos
ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_models_read" ON ai_models
  FOR SELECT USING (true);

CREATE POLICY "ai_models_admin" ON ai_models
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM members m
      WHERE m.user_id = auth.uid()
        AND m.role >= 30  -- WORSHIP_LEADER ou superior
    )
  );

-- Registra o modelo inicial (mock para dev, bs_roformer quando disponível)
INSERT INTO ai_models (name, family, version, stem_schema, active)
VALUES (
  'kroni-separation-mock',
  'mock',
  '1.0.0',
  ARRAY['vocals', 'drums', 'bass', 'other'],
  true
)
ON CONFLICT (name) DO NOTHING;

-- Coluna de rastreabilidade nos jobs de processamento
ALTER TABLE processing_jobs
  ADD COLUMN IF NOT EXISTS model_id      uuid REFERENCES ai_models(id),
  ADD COLUMN IF NOT EXISTS model_version text;

COMMENT ON TABLE ai_models IS
  'Registro de modelos de IA de separação de stems. '
  'Cada música processada referencia o modelo usado para permitir reprocessamento futuro.';

COMMENT ON COLUMN ai_models.stem_schema IS
  'Stems que este modelo entrega. Não hardcoded em nenhum outro lugar do sistema — '
  'o app lê essa lista e exibe as lanes correspondentes.';
