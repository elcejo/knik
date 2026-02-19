// --- MOTOR DE CARRERA: EDICIÓN PROFESIONAL HQ (REDISENO OBSTÁCULOS) ---
(function () {
    "use strict";

    // --- PRNG ---
    function sfc32(a, b, c, d) {
        return function () {
            a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
            var t = (a + b | 0) + d | 0;
            d = d + 1 | 0;
            a = b ^ b >>> 9;
            b = c + (c << 3) | 0;
            c = (c << 21 | c >>> 11);
            c = c + t | 0;
            return (t >>> 0) / 4294967296;
        }
    }
    function getSeedFunction(str) {
        let h = 1779033703 ^ (str ? str.length : 0);
        for (let i = 0; i < (str ? str.length : 0); i++) h = Math.imul(h ^ str.charCodeAt(i), 3432918353), h = h << 13 | h >>> 19;
        return sfc32(h, h, h, h);
    }

    // --- Estado Global ---
    const State = {
        canvas: null,
        ctx: null,
        engine: null,
        world: null,
        marbles: [],
        winners: [],
        flagImages: {},
        textureCache: new Map(),
        trailData: new Map(),
        confetti: [],
        isRecording: false,
        recorder: null,
        chunks: [],
        raceFinished: false,
        showPodium: false,
        podiumAlpha: 0,
        viewY: 0,
        mapHeight: 10000,
        currentFormat: { w: 1080, h: 1920 },
        currentTheme: 'colors',

        // --- CONFIGURACIÓN ---
        MARBLE_RADIUS: 35,
        TARGET_FPS: 24,
        PHYSICS_FPS: 144,
        GLOW_SIZE: 45,
        WALL_THICKNESS: 200, // Paredes reforzadas

        THEMES: {
            colors: null,
            emojis: ["⚽", "🍎", "🐱", "🐶", "🚀", "🍕", "🎸", "👾", "🦊", "🐯", "🐼", "🐸", "🐳", "🥥", "💎", "🔥", "🌈", "⭐", "🍀", "🍄"],
            countries: [
                { id: "in", name: "India" }, { id: "cn", name: "China" }, { id: "us", name: "USA" },
                { id: "id", name: "Indonesia" }, { id: "pk", name: "Pakistan" }, { id: "ng", name: "Nigeria" },
                { id: "br", name: "Brazil" }, { id: "bd", name: "Bangladesh" }, { id: "ru", name: "Russia" },
                { id: "mx", name: "Mexico" }, { id: "jp", name: "Japan" }, { id: "et", name: "Ethiopia" },
                { id: "ph", name: "Philippines" }, { id: "eg", name: "Egypt" }, { id: "vn", name: "Vietnam" }
            ]
        }
    };

    let lastTime = 0;
    const frameInterval = 1000 / State.TARGET_FPS;

    function log(msg) {
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.innerText = msg;
    }

    function loadResources() {
        State.THEMES.countries.forEach(c => {
            const img = new Image();
            img.src = `temas/paises/${c.id}.png`;
            State.flagImages[c.id] = img;
        });
    }

    function init() {
        State.canvas = document.getElementById('raceCanvas');
        if (!State.canvas) return;
        State.ctx = State.canvas.getContext('2d', { alpha: false });

        document.getElementById('btnPreview').onclick = () => startSimulation(false);
        document.getElementById('btnRecord').onclick = () => startSimulation(true);
        document.getElementById('btnRandomize').onclick = () => {
            const s = () => Math.random().toString(36).substring(2, 7).toUpperCase();
            document.getElementById('mapSeed').value = s();
            document.getElementById('raceSeed').value = s();
        };

        const themeSelect = document.getElementById('themeSelect');
        if (themeSelect) themeSelect.onchange = (e) => State.currentTheme = e.target.value;

        document.querySelectorAll('.format-btn').forEach(btn => {
            btn.onclick = (e) => {
                document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const f = btn.dataset.format;
                if (f === 'vertical') State.currentFormat = { w: 1080, h: 1920 };
                else if (f === 'square') State.currentFormat = { w: 1080, h: 1080 };
                else State.currentFormat = { w: 1920, h: 1080 };
                updateCanvas();
            };
        });

        const toggle = document.getElementById('sidebar-toggle');
        const overlay = document.getElementById('ui-overlay');
        if (toggle && overlay) toggle.onclick = () => overlay.classList.toggle('collapsed');

        updateCanvas();
        loadResources();
        requestAnimationFrame(loop);
    }

    function updateCanvas() {
        State.canvas.width = State.currentFormat.w;
        State.canvas.height = State.currentFormat.h;
    }

    function cacheMarbleTexture(marble) {
        const size = (State.MARBLE_RADIUS + State.GLOW_SIZE) * 2;
        const offCanvas = document.createElement('canvas');
        offCanvas.width = size; offCanvas.height = size;
        const octx = offCanvas.getContext('2d');
        const center = size / 2;
        const r = State.MARBLE_RADIUS;

        octx.save();
        octx.translate(center, center);

        // Brillo exterior más potente
        octx.shadowBlur = 45;
        octx.shadowColor = marble.customColor;

        if (marble.customType === 'color') {
            octx.beginPath(); octx.arc(0, 0, r, 0, Math.PI * 2);
            octx.fillStyle = marble.customColor; octx.fill();
        } else if (marble.customType === 'emoji') {
            octx.font = '65px Outfit'; octx.textAlign = 'center'; octx.textBaseline = 'middle';
            octx.fillText(marble.customContent, 0, 0);
        } else if (marble.customType === 'flag') {
            // Para banderas, dibujamos un círculo de fondo con brillo antes del clip
            octx.beginPath(); octx.arc(0, 0, r, 0, Math.PI * 2);
            octx.fillStyle = marble.customColor; octx.fill();

            if (marble.customContent && marble.customContent.complete) {
                octx.save();
                octx.beginPath(); octx.arc(0, 0, r, 0, Math.PI * 2); octx.clip();
                octx.drawImage(marble.customContent, -r * 1.5, -r, r * 3, r * 2);
                octx.restore();
            }
        }
        octx.restore();
        State.textureCache.set(marble.id, offCanvas);
    }

    function startSimulation(record) {
        log("Preparando Mapa...");
        if (State.engine) {
            Matter.World.clear(State.world);
            Matter.Engine.clear(State.engine);
        }
        State.engine = Matter.Engine.create();
        State.world = State.engine.world;
        State.engine.gravity.y = 1.2;

        const mSeed = document.getElementById('mapSeed').value || "MAP";
        const rSeed = document.getElementById('raceSeed').value || "RACE";
        const count = parseInt(document.getElementById('marbleCount').value) || 12;
        const lengthInput = document.getElementById('lengthSelect');
        State.mapHeight = parseInt(lengthInput ? lengthInput.value : 10000) || 10000;

        State.marbles = [];
        State.winners = [];
        State.trailData.clear();
        State.textureCache.clear();
        State.confetti = [];
        State.raceFinished = false;
        State.showPodium = false;
        State.podiumAlpha = 0;
        State.viewY = 0;

        createMap(mSeed);
        createMarbles(rSeed, count);
        State.marbles.forEach(m => cacheMarbleTexture(m));

        // Registro de colisiones para iluminación reactiva
        Matter.Events.on(State.engine, 'collisionStart', (event) => {
            event.pairs.forEach(pair => {
                let m = null, o = null;
                if (pair.bodyA.label.startsWith('marble')) { m = pair.bodyA; o = pair.bodyB; }
                else if (pair.bodyB.label.startsWith('marble')) { m = pair.bodyB; o = pair.bodyA; }

                if (m && o) {
                    let target = o;
                    if (o.parent && o.parent !== o) target = o.parent;

                    if (target.label === 'rampa' || target.label === 'plinko' || target.label === 'molino' || target.label === 'anillo' || target.label === 'bumper') {
                        target.glowColor = m.customColor;
                        target.glowLife = 1.0;
                    }

                    // Efecto Bumper: Rebote potente
                    if (target.label === 'bumper') {
                        const forceDir = Matter.Vector.normalise(Matter.Vector.sub(m.position, target.position));
                        const impulse = Matter.Vector.mult(forceDir, 45); // Impulso tipo pinball
                        Matter.Body.setVelocity(m, impulse);
                    }
                }
            });
        });

        log(record ? "Grabando vídeo HQ..." : "Carrera activa");
        if (record) startRecording();
    }

    function createMap(seed) {
        const rand = getSeedFunction(seed);
        const w = State.currentFormat.w;
        const h = State.mapHeight;
        const t = State.WALL_THICKNESS;

        // Limites reforzados (Paredes y Techo)
        Matter.Composite.add(State.world, [
            Matter.Bodies.rectangle(-t / 2, h / 2, t, h, { isStatic: true, label: 'wall' }),
            Matter.Bodies.rectangle(w + t / 2, h / 2, t, h, { isStatic: true, label: 'wall' }),
            Matter.Bodies.rectangle(w / 2, -t / 2, w + t * 2, t, { isStatic: true, label: 'wall' })
        ]);

        let y = 600;
        while (y < h - 1200) {
            const dice = rand();
            if (dice < 0.2) {
                // RAMPAS
                const pw = w * 0.45;
                const px = rand() < 0.5 ? pw / 2 : w - pw / 2;
                const angle = (0.35 + rand() * 0.3) * (px < w / 2 ? 1 : -1);
                const rampa = Matter.Bodies.rectangle(px, y, pw, 60, { isStatic: true, angle: angle, label: 'rampa' });
                rampa.glowLife = 0; rampa.glowColor = '#fff';
                Matter.Composite.add(State.world, rampa);
                y += 500;
            } else if (dice < 0.35) {
                // PLINKOS
                const rows = 5;
                const baseCols = 6;
                const gapX = 130;
                const gapY = 180;
                for (let r = 0; r < rows; r++) {
                    const isOddRow = (r % 2 !== 0);
                    const numCols = isOddRow ? baseCols + 1 : baseCols;
                    const rowWidth = (numCols - 1) * gapX;
                    const startX = (w - rowWidth) / 2;
                    for (let c = 0; c < numCols; c++) {
                        const px = startX + c * gapX;
                        const plinko = Matter.Bodies.circle(px, y + r * gapY, 18, { isStatic: true, label: 'plinko' });
                        plinko.glowLife = 0; plinko.glowColor = '#fff';
                        Matter.Composite.add(State.world, plinko);
                    }
                }
                y += rows * gapY + 350;
            } else if (dice < 0.5) {
                // MOLINOS
                const center = w * 0.2 + w * 0.6 * rand();
                const bar1 = Matter.Bodies.rectangle(center, y, w * 0.35, 25, { label: 'molino' });
                const bar2 = Matter.Bodies.rectangle(center, y, 25, w * 0.35, { label: 'molino' });
                const molino = Matter.Body.create({ parts: [bar1, bar2], isStatic: false, label: 'molino' });
                molino.customSpin = (rand() < 0.5 ? 1 : -1) * (0.08 + rand() * 0.1);
                molino.glowLife = 0; molino.glowColor = '#fff';
                Matter.Composite.add(State.world, [
                    molino,
                    Matter.Constraint.create({ pointA: { x: center, y: y }, bodyB: molino, stiffness: 1, length: 0 })
                ]);
                y += 600;
            } else if (dice < 0.65) {
                // VORTEX (Huracán)
                const center = w * 0.2 + w * 0.6 * rand();
                const radius = 200 + rand() * 100;
                const vortex = Matter.Bodies.circle(center, y, radius, { isStatic: true, isSensor: true, label: 'vortex' });
                vortex.vortexRadius = radius;
                vortex.vortexForce = 0.05 + rand() * 0.05;
                vortex.rotation = 0;
                Matter.Composite.add(State.world, vortex);
                y += radius * 2 + 200;
            } else if (dice < 0.85) {
                // ANILLOS GIRATORIOS
                const center = w * 0.5;
                const radius = 250;
                const thickness = 40;
                const numSlots = 4 + Math.floor(rand() * 3); // 4 a 6 ranuras
                const segments = [];
                const angleStep = (Math.PI * 2) / numSlots;
                const slotRatio = 0.3; // Hueco del 30% del arco

                for (let i = 0; i < numSlots; i++) {
                    const startAngle = i * angleStep;
                    const endAngle = startAngle + angleStep * (1 - slotRatio);
                    const midAngle = (startAngle + endAngle) / 2;
                    const arcLength = radius * (angleStep * (1 - slotRatio));

                    const seg = Matter.Bodies.rectangle(
                        center + Math.cos(midAngle) * radius,
                        y + Math.sin(midAngle) * radius,
                        arcLength, thickness, {
                        angle: midAngle + Math.PI / 2,
                        label: 'anillo'
                    }
                    );
                    segments.push(seg);
                }

                const anillo = Matter.Body.create({ parts: segments, isStatic: false, label: 'anillo' });
                anillo.customSpin = (rand() < 0.5 ? 1 : -1) * (0.04 + rand() * 0.04);
                anillo.glowLife = 0; anillo.glowColor = '#fff';
                Matter.Composite.add(State.world, [
                    anillo,
                    Matter.Constraint.create({ pointA: { x: center, y: y }, bodyB: anillo, stiffness: 1, length: 0 })
                ]);
                y += radius * 2 + 400;
            } else {
                // BUMPERS (Pinball)
                const center = w * 0.2 + w * 0.6 * rand();
                const bumper = Matter.Bodies.circle(center, y, 60, { isStatic: true, label: 'bumper' });
                bumper.glowLife = 0; bumper.glowColor = '#fff';
                Matter.Composite.add(State.world, bumper);
                y += 400;
            }
            y += rand() * 200;
        }

        // Bloque de Seguridad antes de la meta (Embudo)
        Matter.Composite.add(State.world, [
            Matter.Bodies.rectangle(w * 0.1, h - 600, w * 0.3, 40, { isStatic: true, angle: 0.5 }),
            Matter.Bodies.rectangle(w * 0.9, h - 600, w * 0.3, 40, { isStatic: true, angle: -0.5 })
        ]);

        Matter.Composite.add(State.world, Matter.Bodies.rectangle(w / 2, h - 100, w, 30, { isStatic: true, isSensor: true, label: 'finish' }));
    }

    function createMarbles(seed, count) {
        const rand = getSeedFunction(seed);
        const w = State.currentFormat.w;
        const colors = ['#f05', '#0ef', '#fc0', '#0f6', '#a0f', '#f60', '#06f', '#fff', '#f3c', '#3f9'];
        for (let i = 0; i < count; i++) {
            const mx = w * 0.2 + w * 0.6 * rand();
            const marble = Matter.Bodies.circle(mx, 100 + i * 10, State.MARBLE_RADIUS, { restitution: 0.5, friction: 0.005, frictionAir: 0.001, label: 'marble-' + i });
            marble.customColor = colors[i % colors.length];
            State.trailData.set(marble.id, []);
            if (State.currentTheme === 'emojis') {
                marble.customType = 'emoji'; marble.customContent = State.THEMES.emojis[i % State.THEMES.emojis.length]; marble.customName = marble.customContent;
            } else if (State.currentTheme === 'countries') {
                marble.customType = 'flag'; const c = State.THEMES.countries[i % State.THEMES.countries.length]; marble.customContent = State.flagImages[c.id]; marble.customName = c.name;
            } else {
                marble.customType = 'color'; marble.customName = ["Rojo", "Cian", "Oro", "Lima", "Púrpura", "Naranja", "Azul", "Blanco", "Rosa", "Menta"][i % 10];
            }
            State.marbles.push(marble); Matter.Composite.add(State.world, marble);
        }
    }

    function loop(timestamp) {
        requestAnimationFrame(loop);
        if (!State.ctx || !State.engine) return;
        const deltaTime = timestamp - lastTime;
        if (deltaTime >= frameInterval) {
            lastTime = timestamp - (deltaTime % frameInterval);
            if (!State.raceFinished && !State.showPodium && State.marbles.length > 0) {
                const steps = Math.floor(State.PHYSICS_FPS / State.TARGET_FPS);
                const physDelta = 1000 / State.PHYSICS_FPS;
                for (let s = 0; s < steps; s++) {
                    State.world.bodies.forEach(b => {
                        if (b.customSpin) Matter.Body.setAngularVelocity(b, b.customSpin);
                        if (b.glowLife > 0) b.glowLife -= 0.005;

                        // Lógica de Vortex: Aplicar fuerzas a las canicas cercanas
                        if (b.label === 'vortex') {
                            b.rotation += 0.1; // Para la animación visual
                            State.marbles.forEach(m => {
                                const dist = Matter.Vector.magnitude(Matter.Vector.sub(m.position, b.position));
                                if (dist < b.vortexRadius) {
                                    const forceDir = Matter.Vector.normalise(Matter.Vector.sub(b.position, m.position));
                                    const tangent = { x: -forceDir.y, y: forceDir.x };
                                    // Combinar fuerza de succión radial y fuerza tangencial (giro)
                                    const totalForce = Matter.Vector.add(
                                        Matter.Vector.mult(forceDir, b.vortexForce * 0.2),
                                        Matter.Vector.mult(tangent, b.vortexForce)
                                    );
                                    Matter.Body.applyForce(m, m.position, totalForce);
                                }
                            });
                        }
                    });
                    Matter.Engine.update(State.engine, physDelta);
                    checkLogic();
                }
                updateView();
            }
            if (State.showPodium && State.podiumAlpha < 1) State.podiumAlpha += 0.05;
            render();
        }
    }

    function checkLogic() {
        State.marbles.forEach(m => {
            if (!m.customFinished && m.position.y > State.mapHeight - 150) {
                m.customFinished = true;
                State.winners.push({ name: m.customName, color: m.customColor, id: m.id });
                if (State.winners.length === 3 || State.winners.length === State.marbles.length) {
                    State.raceFinished = true;
                    initConfetti();
                    setTimeout(() => { State.showPodium = true; if (State.isRecording) setTimeout(stopRecording, 5000); }, 800);
                }
            }
            if (!m.customFinished) {
                const trail = State.trailData.get(m.id);
                trail.push({ x: m.position.x, y: m.position.y });
                if (trail.length > 15) trail.shift();
            }
        });
    }

    function updateView() {
        if (State.marbles.length === 0) return;
        const remaining = State.marbles.filter(m => !m.customFinished);
        let target = remaining.length > 0 ? remaining.reduce((a, b) => (b.position.y > a.position.y) ? b : a) : { position: { y: State.mapHeight - 200 } };
        const ty = target.position.y - State.currentFormat.h / 3;
        const maxScroll = State.mapHeight - State.currentFormat.h;
        State.viewY += (Math.max(0, Math.min(ty, maxScroll)) - State.viewY) * 0.15;
    }

    function initConfetti() {
        State.confetti = [];
        for (let i = 0; i < 200; i++) {
            State.confetti.push({
                x: Math.random() * State.currentFormat.w, y: -Math.random() * 500,
                vx: (Math.random() - 0.5) * 15, vy: Math.random() * 8 + 4,
                w: Math.random() * 12 + 6, h: Math.random() * 12 + 6,
                color: `hsl(${Math.random() * 360}, 100%, 50%)`,
                rotation: Math.random() * Math.PI, rotationSpeed: (Math.random() - 0.5) * 0.2
            });
        }
    }

    function render() {
        const ctx = State.ctx;
        ctx.fillStyle = "#0a0a0c";
        ctx.fillRect(0, 0, State.currentFormat.w, State.currentFormat.h);
        ctx.save();
        ctx.translate(0, -State.viewY);

        // Trails
        State.marbles.forEach(m => {
            const tr = State.trailData.get(m.id);
            if (tr?.length > 1) {
                ctx.beginPath(); ctx.moveTo(tr[0].x, tr[0].y);
                for (let i = 1; i < tr.length; i++) ctx.lineTo(tr[i].x, tr[i].y);
                ctx.strokeStyle = m.customColor; ctx.lineWidth = 12; ctx.globalAlpha = 0.2; ctx.stroke(); ctx.globalAlpha = 1.0;
            }
        });

        // Bodies
        Matter.Composite.allBodies(State.world).forEach(b => {
            if (b.label.startsWith('marble')) {
                const tex = State.textureCache.get(b.id);
                if (tex) {
                    ctx.save(); ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
                    const off = State.MARBLE_RADIUS + State.GLOW_SIZE; ctx.drawImage(tex, -off, -off); ctx.restore();
                }
            } else if (b.label === 'vortex') {
                // Dibujar Vortex (Huiracán animado)
                ctx.save();
                ctx.translate(b.position.x, b.position.y);
                ctx.rotate(b.rotation);
                ctx.globalAlpha = 0.3;

                for (let i = 0; i < 3; i++) {
                    ctx.beginPath();
                    ctx.arc(0, 0, b.vortexRadius * (0.4 + i * 0.3), 0, Math.PI * 1.5);
                    ctx.strokeStyle = "#fff";
                    ctx.lineWidth = 15 - i * 4;
                    ctx.stroke();
                    ctx.rotate(Math.PI * 0.5);
                }

                ctx.restore();
            } else {
                // Soporte para cuerpos compuestos y otros obstáculos
                const drawPart = (part) => {
                    ctx.beginPath();
                    ctx.moveTo(part.vertices[0].x, part.vertices[0].y);
                    for (let i = 1; i < part.vertices.length; i++) ctx.lineTo(part.vertices[i].x, part.vertices[i].y);
                    ctx.closePath();

                    if (b.glowLife > 0) {
                        ctx.shadowBlur = (b.label === 'bumper' ? 80 : 40) * b.glowLife;
                        ctx.shadowColor = b.glowColor;
                        ctx.fillStyle = b.glowColor;
                    } else {
                        ctx.shadowBlur = 0;
                        if (b.label === 'bumper') {
                            ctx.fillStyle = "#333";
                            ctx.strokeStyle = "#555";
                            ctx.lineWidth = 5;
                            ctx.stroke();
                        } else {
                            ctx.fillStyle = b.label === 'finish' ? "#f05" : (b.label === 'wall' ? "#0f0f12" : "#222");
                        }
                    }
                    ctx.fill();
                };

                if (b.parts && b.parts.length > 1) {
                    for (let i = 1; i < b.parts.length; i++) drawPart(b.parts[i]);
                } else {
                    drawPart(b);
                }
            }
        });
        ctx.restore();
        if (!State.showPodium && State.marbles.length > 0) drawHUD();
        if (State.showPodium) { drawPodium(); updateAndDrawConfetti(); }
    }

    function drawHUD() {
        const ctx = State.ctx;
        const sorted = [...State.marbles].sort((a, b) => b.position.y - a.position.y);
        const w = State.currentFormat.w;
        const panelW = 480, panelH = 680;
        const x = w - panelW - 40, y = 40;

        // --- Panel Principal (Glassmorphism) ---
        ctx.save();
        ctx.shadowBlur = 40; ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.fillStyle = "rgba(15, 15, 25, 0.85)";
        if (ctx.roundRect) ctx.roundRect(x, y, panelW, panelH, 24).fill();
        else ctx.fillRect(x, y, panelW, panelH);

        // Borde fino brillante
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        // Título
        ctx.fillStyle = "#0ef"; ctx.font = "bold 30px Outfit";
        ctx.textAlign = "center";
        ctx.fillText("LÍDERES KNIK", x + panelW / 2, y + 55);

        // Línea divisoria
        ctx.beginPath(); ctx.moveTo(x + 40, y + 75); ctx.lineTo(x + panelW - 40, y + 75);
        ctx.strokeStyle = "rgba(0, 238, 255, 0.3)"; ctx.lineWidth = 1; ctx.stroke();

        sorted.slice(0, 10).forEach((m, i) => {
            const ty = y + 130 + i * 54;
            const progress = Math.min(100, Math.max(0, (m.position.y / State.mapHeight) * 100));

            // 1. Puesto y Medalla
            ctx.textAlign = "left";
            if (i < 3) {
                const colors = ["#FFD700", "#C0C0C0", "#CD7F32"];
                ctx.fillStyle = colors[i];
                ctx.font = "bold 24px Outfit";
                ctx.fillText(["🥇", "🥈", "🥉"][i], x + 25, ty);
            } else {
                ctx.fillStyle = "rgba(255,255,255,0.5)";
                ctx.font = "20px Outfit";
                ctx.fillText(i + 1, x + 35, ty);
            }

            // 2. Icono de Canica
            ctx.fillStyle = m.customColor;
            ctx.shadowBlur = 10; ctx.shadowColor = m.customColor;
            ctx.beginPath(); ctx.arc(x + 85, ty - 8, 14, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;

            // 3. Nombre
            ctx.fillStyle = "#fff"; ctx.font = "bold 22px Outfit";
            ctx.fillText(m.customName.substring(0, 14), x + 115, ty);

            // 4. Distancia
            ctx.textAlign = "right";
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.font = "20px Outfit";
            ctx.fillText(Math.round(m.position.y / 10) + "m", x + panelW - 30, ty);

            // 5. Barra de Progreso Mini
            const barBoxX = x + 115, barBoxY = ty + 8, barW = panelW - 145, barH = 4;
            ctx.fillStyle = "rgba(255,255,255,0.1)";
            ctx.fillRect(barBoxX, barBoxY, barW, barH);
            ctx.fillStyle = m.customColor;
            ctx.fillRect(barBoxX, barBoxY, (barW * progress) / 100, barH);
        });
    }

    function drawPodium() {
        const ctx = State.ctx;
        const w = State.currentFormat.w, fade = State.podiumAlpha;
        ctx.save(); ctx.globalAlpha = fade;
        ctx.fillStyle = "rgba(0,0,0,0.98)"; ctx.fillRect(0, 0, w, State.currentFormat.h);
        ctx.textAlign = "center"; ctx.fillStyle = "#0ef"; ctx.font = "bold 90px Outfit";
        ctx.save(); ctx.translate(w / 2, 250); ctx.scale(0.85 + 0.15 * fade, 0.85 + 0.15 * fade); ctx.fillText("¡PODIO FINAL!", 0, 0); ctx.restore();
        const cfg = [{ p: 2, x: -300, h: 250, c: "#C0C0C0", l: "2º" }, { p: 1, x: 0, h: 360, c: "#FFD700", l: "1º" }, { p: 3, x: 300, h: 180, c: "#CD7F32", l: "3º" }];
        cfg.forEach(c => {
            const win = State.winners[c.p - 1]; if (!win) return;
            const x = w / 2 + c.x, py = 1350;
            ctx.fillStyle = c.c; ctx.fillRect(x - 140, py - c.h, 280, c.h);
            const tex = State.textureCache.get(win.id);
            if (tex) {
                ctx.save(); ctx.translate(x, py - c.h - 150);
                const s = 2.4 * fade; ctx.drawImage(tex, -tex.width * s / 2, -tex.height * s / 2, tex.width * s, tex.height * s);
                ctx.restore();
            }
            ctx.fillStyle = "#fff"; ctx.font = "bold 45px Outfit"; ctx.fillText(win.name, x, py - c.h - 300);
        });
        ctx.restore();
    }

    function updateAndDrawConfetti() {
        const ctx = State.ctx;
        State.confetti.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.rotation += p.rotationSpeed;
            if (p.y > State.currentFormat.h) { p.y = -20; p.x = Math.random() * State.currentFormat.w; }
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation); ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
        });
    }

    function startRecording() {
        try {
            State.isRecording = true; State.chunks = [];
            const str = State.canvas.captureStream(State.TARGET_FPS);
            const m = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(it => MediaRecorder.isTypeSupported(it));
            State.recorder = new MediaRecorder(str, { mimeType: m, videoBitsPerSecond: 8000000 });
            State.recorder.ondataavailable = (e) => State.chunks.push(e.data);
            State.recorder.onstop = () => {
                const b = new Blob(State.chunks, { type: 'video/webm' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `pro-race-${Date.now()}.webm`; a.click();
                State.isRecording = false; log("Vídeo HQ listo");
            };
            State.recorder.start();
        } catch (e) { log("Error: " + e.message); State.isRecording = false; }
    }

    function stopRecording() { if (State.recorder?.state === "recording") State.recorder.stop(); }

    if (CanvasRenderingContext2D.prototype && !CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
            this.beginPath(); this.moveTo(x + r, y);
            this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
            this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r);
            this.closePath(); return this;
        };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
