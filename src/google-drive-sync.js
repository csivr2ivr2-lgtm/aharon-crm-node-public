import {randomUUID} from 'node:crypto';
const fields='id,name,mimeType,modifiedTime,webViewLink,version,headRevisionId,trashed,capabilities(canDownload,canEdit)';
const token=v=>{if(typeof v!=='string'||!v||v.length>8192)throw Error('drive_cursor_missing');return v;};
function fileRecord(file){
 if(typeof file?.id!=='string'||!file.id)throw Error('drive_file_id_missing');
 return {id:file.id,available:!file.trashed,name:file.name||'',mimeType:file.mimeType||'',modifiedTime:file.modifiedTime||'',
  webViewLink:file.webViewLink||'',version:String(file.version||''),headRevisionId:file.headRevisionId||'',
  capabilities:{canDownload:file.capabilities?.canDownload===true,canEdit:file.capabilities?.canEdit===true}};
}
export async function driveSyncPage(drive,state=null){
 let current=state;
 if(!current){const start=(await drive.changes.getStartPageToken({supportsAllDrives:true})).data;
  current={version:1,mode:'full',anchor:token(start.startPageToken),page:'',generation:randomUUID()};}
 if(current.version!==1||!['full','delta'].includes(current.mode)||!current.generation)throw Error('invalid_drive_sync_state');
 token(current.anchor);
 let data,items,nextState;
 try{
  if(current.mode==='full'){
   data=(await drive.files.list({spaces:'drive',pageSize:100,supportsAllDrives:true,includeItemsFromAllDrives:true,
    fields:'incompleteSearch,nextPageToken,files('+fields+')',...(current.page?{pageToken:current.page}:{})})).data;
   if(data.incompleteSearch)throw Error('drive_incomplete_search');
   items=(data.files||[]).map(fileRecord);
   nextState={...current,mode:data.nextPageToken?'full':'delta',page:data.nextPageToken||''};
  }else{
   data=(await drive.changes.list({pageToken:current.page||current.anchor,pageSize:100,spaces:'drive',
    supportsAllDrives:true,includeItemsFromAllDrives:true,includeRemoved:true,
    fields:'nextPageToken,newStartPageToken,changes(changeType,fileId,removed,file('+fields+'))'})).data;
   items=[];
   for(const change of data.changes||[]){
    if(change.changeType==='drive')continue;
    if(!change.fileId)throw Error('drive_change_id_missing');
    if(change.removed)items.push({id:change.fileId,available:false});
    else {const item=fileRecord(change.file);if(item.id!==change.fileId)throw Error('drive_change_id_mismatch');items.push(item);}
   }
   nextState={...current,anchor:data.nextPageToken?current.anchor:token(data.newStartPageToken),page:data.nextPageToken||''};
  }
 }catch(error){
  if(Number(error?.response?.status||error?.code)!==410)throw error;
  if(!state)throw error;
  const fresh=await driveSyncPage(drive,null);return {...fresh,recovered:true};
 }
 if(data.nextPageToken&&data.nextPageToken===(current.page||current.anchor))throw Error('drive_cursor_not_advancing');
 return {items,nextState,recovered:false};
}
