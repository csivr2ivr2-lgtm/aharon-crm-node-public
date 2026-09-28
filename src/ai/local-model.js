export const SUPRA_MODEL='onnx-community/Supra-50M-Instruct-ONNX';
export const SUPRA_TOKENIZER='SupraLabs/Supra-50M-Instruct';
export const LEGACY_LOCAL_MODELS=['onnx-community/Qwen2.5-0.5B-Instruct','onnx-community/SmolLM2-135M-Instruct-ONNX-MHA'];
export function normalizeLocalModel(value,fallback=SUPRA_MODEL){
 const model=typeof value==='string'?value.trim():'';
 return LEGACY_LOCAL_MODELS.includes(model)?SUPRA_MODEL:model||fallback;
}
export const tokenizerForModel=model=>model===SUPRA_MODEL?SUPRA_TOKENIZER:model;
// Saved settings take precedence; env is only the default for an unset model.
export function resolveLocalModel(settings={},environment={}){
 const model=normalizeLocalModel(settings.localModel,normalizeLocalModel(environment.localAiModel));
 return {model,tokenizer:tokenizerForModel(model),dtype:environment.localAiDtype||'q4'};
}
