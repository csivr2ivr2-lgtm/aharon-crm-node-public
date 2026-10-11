export function pairingPhoneNumber(input){
 const number=String(input||"").trim();
 if(!/^[1-9]\d{7,14}$/.test(number))throw Error("invalid_whatsapp_pairing_number");
 return number;
}
