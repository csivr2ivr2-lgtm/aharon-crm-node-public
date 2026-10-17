// A checkpoint may advance only after an explicit storage acknowledgement.
export function ingestionOutcome(result){
 if(!result || typeof result.inserted!=='boolean' || result.skipped)
  throw Error('message_persistence_unacknowledged');
 return result.inserted?'imported':'duplicate';
}
