import {validateLanguage} from './custom-language.mjs';
import {validateAPI} from './language-model.mjs';
export function restoreLanguageSettings(settings={}){
  const warnings=[];
  function entries(value,label){if(value===undefined)return [];if(!value||typeof value!=='object'||Array.isArray(value)){warnings.push(`Skipped invalid ${label}.`);return [];}return Object.entries(value);}
  const customLanguages=[],apiEntries=[];
  for(const [name,value] of entries(settings?.customLanguages,'custom language settings')){
    try{const definition=validateLanguage(value);if(definition.name!==name)throw new Error('Name does not match the saved key');customLanguages.push([name,definition]);}
    catch(error){warnings.push(`Skipped custom language ${name}: ${error.message}`);}
  }
  for(const [name,value] of entries(settings?.apiEntries,'API settings')){
    try{apiEntries.push([name,validateAPI(value)]);}catch(error){warnings.push(`Skipped API definitions for ${name}: ${error.message}`);}
  }
  return {settings:{customLanguages:Object.fromEntries(customLanguages),apiEntries:Object.fromEntries(apiEntries)},warnings};
}
