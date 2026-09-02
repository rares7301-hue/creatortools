const ideas=[
"Fă un videoclip în care testezi 5 lucruri virale.",
"Arată cum faci ceva în 30 de secunde.",
"Spune 3 greșeli pe care le fac începătorii.",
"Fă un top 5 cu lucrurile tale preferate.",
"Transformă un comentariu într-un videoclip.",
"Arată un before/after al unui proiect.",
"Fă un challenge creativ fără să copiezi trendul exact.",
"Spune o poveste amuzantă din viața ta."
];
const names=["Vibe","Nova","Flash","Pixel","Rush","Wave","Clips","Zone","Flow","Creator"];
const captions=[
"POV: ai zis că faci un singur videoclip 😭",
"Cred că merită un part 2 👀",
"Tu ce ai fi făcut?",
"Salvează asta pentru mai târziu 🔥",
"Am încercat și chiar a mers.",
"Nu mă așteptam la rezultatul ăsta."
];
function pick(a){return a[Math.floor(Math.random()*a.length)]}
function generateIdea(){document.getElementById("idea").textContent=pick(ideas)}
function generateUsername(){document.getElementById("username").textContent=pick(names)+pick(names)+Math.floor(Math.random()*999)}
function generateCaption(){document.getElementById("caption").textContent=pick(captions)}
