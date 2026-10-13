import * as THREE from 'three';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/loaders/FBXLoader.js';

const startupConnectionMessage = document.getElementById('connection-message');
if (startupConnectionMessage) {
  startupConnectionMessage.textContent = 'Game code started; connecting to multiplayer...';
}


const $ = id => document.getElementById(id);
const loading = $('loading');
const loadingMessage = $('loading-message');
const statusText = $('status-text');
const toast = $('toast');

let scene, camera, renderer, clock;
let player, vehicle, vehicleModel;
let plane = null, flyingPlane = false;
let planeSpeed = 0, planeVerticalSpeed = 0;
const vehicles = [];

// Shared city collision footprints and autonomous local citizens.
const cityObstacles = [];
const generatedBuildings = [];
// Enterable bungalow state.
let insideHouse = false;
let insideGeneratedBuilding = false;
let generatedBuildingReturn = null;
const generatedInteriorOrigin = { x: 240, z: 240 };
const generatedInteriorObstacles = [];
const interiorOrigin = { x: 180, z: 180 };
const interiorObstacles = [];
const houseDoor = { x: 8, z: -7 };

const aiBots = [];
let driving = false, running = false, cameraMode = 0;

// Martins DeMatrix 5D: music only while inside a car or plane.
let vehicleMusicAudio = null;
let vehicleMusicMuted = false;

function ensureVehicleMusic() {
  if (vehicleMusicAudio) return;

  vehicleMusicAudio = new Audio('/assets/music/together.mp3');
  vehicleMusicAudio.loop = true;
  vehicleMusicAudio.volume = 0.45;
  vehicleMusicAudio.preload = 'auto';

  const panel = document.createElement('div');
  panel.id = 'vehicle-music-panel';
  panel.style.cssText =
    'position:fixed;right:10px;bottom:12px;z-index:9999;' +
    'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' +
    'max-width:calc(100vw - 20px);padding:9px 11px;' +
    'border:1px solid #d6ad55;border-radius:12px;' +
    'background:rgba(15,18,28,.92);color:#f8d77a;' +
    'font:12px Arial,sans-serif;box-shadow:0 3px 14px #0006;';

  const label = document.createElement('span');
  label.textContent = 'VEHICLE MUSIC';

  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.value = '45';
  volume.setAttribute('aria-label', 'Vehicle music volume');
  volume.style.cssText = 'width:78px;max-width:22vw;accent-color:#e7bd55;';
  volume.addEventListener('input', () => {
    vehicleMusicAudio.volume = Number(volume.value) / 100;
  });

  const mute = document.createElement('button');
  mute.type = 'button';
  mute.textContent = 'MUTE';
  mute.style.cssText =
    'border:1px solid #d6ad55;border-radius:7px;padding:6px 9px;' +
    'background:#25283a;color:#ffe19a;font-weight:bold;';
  mute.addEventListener('click', () => {
    vehicleMusicMuted = !vehicleMusicMuted;
    mute.textContent = vehicleMusicMuted ? 'UNMUTE' : 'MUTE';

    if (vehicleMusicMuted) {
      vehicleMusicAudio.pause();
    } else if (driving || flyingPlane) {
      startVehicleMusic();
    }
  });

  panel.append(label, volume, mute);
  document.body.appendChild(panel);
}

function startVehicleMusic() {
  ensureVehicleMusic();
  if (vehicleMusicMuted) return;

  const result = vehicleMusicAudio.play();
  if (result && typeof result.catch === 'function') {
    result.catch(error => {
      console.warn('Vehicle music could not start:', error);
    });
  }
}

function stopVehicleMusic() {
  if (!vehicleMusicAudio) return;
  vehicleMusicAudio.pause();
  vehicleMusicAudio.currentTime = 0;
}

let lastAttackAt = 0;
let toastTimer;
const keys = new Set();
const held = new Set();
const world = { speed: 0, heading: 0, carHeading: 0 };
const up = new THREE.Vector3(0, 1, 0);
const tempV = new THREE.Vector3();

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function makeMaterial(color, roughness = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function addBox(parent, w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeCity() {
  scene.background = new THREE.Color(0x91c5e5);
  scene.fog = new THREE.Fog(0x91c5e5, 90, 280);

  const hemi = new THREE.HemisphereLight(0xdcefff, 0x596a4a, 2.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0ac, 3);
  sun.position.set(-45, 80, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), makeMaterial(0x688b58));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMat = makeMaterial(0x343b48);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf5d77d });
  const sidewalkMat = makeMaterial(0xa7b1b8);
  for (let i = -4; i <= 4; i++) {
    const p = i * 22;
    const roadA = new THREE.Mesh(new THREE.PlaneGeometry(12, 210), roadMat);
    roadA.rotation.x = -Math.PI / 2;
    roadA.position.set(p, 0.005, 0);
    scene.add(roadA);
    const roadB = new THREE.Mesh(new THREE.PlaneGeometry(210, 12), roadMat);
    roadB.rotation.x = -Math.PI / 2;
    roadB.position.set(0, 0.006, p);
    scene.add(roadB);

    for (let k = -4; k <= 4; k++) {
      const q = k * 22;
      for (const offset of [-7, 7]) {
        const sx = new THREE.Mesh(new THREE.BoxGeometry(1.4, .18, 10), sidewalkMat);
        sx.position.set(p + offset, .06, q);
        scene.add(sx);
        const sz = new THREE.Mesh(new THREE.BoxGeometry(12, .18, 1.4), sidewalkMat);
        sz.position.set(q, .06, p + offset);
        scene.add(sz);
      }
    }
  }

  // Buildings occupy city blocks, leaving the roads open.
  const colors = [0xc9d5df, 0xe4c9a2, 0x9db9c9, 0xc5b2d6, 0xd6d9c8, 0x8da1b2];
  for (let gx = -4; gx <= 4; gx++) {
    for (let gz = -4; gz <= 4; gz++) {
      if (Math.abs(gx) < 1 && Math.abs(gz) < 1) continue;
      const x = gx * 22, z = gz * 22;
      const count = (Math.abs(gx * 7 + gz * 3) % 3) + 1;
      for (let n = 0; n < count; n++) {
        const bx = x + (gx < 0 ? -11 : 11) + (n - (count - 1) / 2) * 2;
        const bz = z + (gz < 0 ? -11 : 11) + (n % 2 ? 1 : -1);
        const w = 4 + ((gx + gz + n + 30) % 3) * 1.1;
        const d = 4.5 + ((gx * 2 - gz + n + 40) % 3);
        const h = 5 + (Math.abs(gx * 11 + gz * 7 + n * 13) % 8) * 2.1;
        const color = colors[Math.abs(gx * 5 + gz * 3 + n) % colors.length];
        const building = new THREE.Group();
        building.position.set(bx, 0, bz);

        // Four walls with an opening for the front entrance.
        const wallT = .35;
        const doorW = 1.4;
        const sideW = (w - doorW) / 2;
        const frontZ = bz + d / 2;

        cityObstacles.push(
          { minX: bx-w/2, maxX: bx+w/2, minZ: bz-d/2-wallT/2, maxZ: bz-d/2+wallT/2 },
          { minX: bx-w/2-wallT/2, maxX: bx-w/2+wallT/2, minZ: bz-d/2, maxZ: bz+d/2 },
          { minX: bx+w/2-wallT/2, maxX: bx+w/2+wallT/2, minZ: bz-d/2, maxZ: bz+d/2 },
          { minX: bx-w/2, maxX: bx-doorW/2, minZ: frontZ-wallT/2, maxZ: frontZ+wallT/2 },
          { minX: bx+doorW/2, maxX: bx+w/2, minZ: frontZ-wallT/2, maxZ: frontZ+wallT/2 }
        );

        generatedBuildings.push({
          x: bx, z: bz, w, d, h,
          doorX: bx, doorZ: frontZ + 1.1
        });

        scene.add(building);
        addBox(building, w, h, wallT, makeMaterial(color), 0, h/2, -d/2);
        addBox(building, wallT, h, d, makeMaterial(color), -w/2, h/2, 0);
        addBox(building, wallT, h, d, makeMaterial(color), w/2, h/2, 0);
        addBox(building, sideW, h, wallT, makeMaterial(color), -doorW/2-sideW/2, h/2, d/2);
        addBox(building, sideW, h, wallT, makeMaterial(color), doorW/2+sideW/2, h/2, d/2);
        addBox(building, w+.18, .25, d+.18, makeMaterial(0x65778a), 0, h+.1, 0);

        const doorTrim = makeMaterial(0x62442f);
        addBox(building, .12, 2.35, .12, doorTrim, -doorW/2, 1.175, d/2+.04);
        addBox(building, .12, 2.35, .12, doorTrim, doorW/2, 1.175, d/2+.04);
        addBox(building, doorW+.12, .12, .12, doorTrim, 0, 2.35, d/2+.04);

        const windowMat = new THREE.MeshStandardMaterial({
          color: 0x8fe0ef, emissive: 0x244d62, emissiveIntensity: .25, roughness: .35
        });
        const rows = Math.min(7, Math.floor(h / 2.2));
        for (let row = 0; row < rows; row++) {
          const wy = 1.25 + row * 2;
          for (let col = -1; col <= 1; col++) {
            if (Math.abs(col) * 1.2 > w / 2 - .4) continue;
            if (col === 0 && wy < 2.5) continue;
            addBox(building, .65, .85, .07, windowMat, col * 1.2, wy, d / 2 + .04);
          }
        }
      }
    }
  }

  // Simple trees around selected blocks.
  const trunkMat = makeMaterial(0x68472d);
  const leafMats = [makeMaterial(0x367b4a), makeMaterial(0x478e55)];
  for (let i = -8; i <= 8; i++) {
    for (const side of [-1, 1]) {
      if (i % 2 === 0) continue;
      const x = i * 10;
      const z = side * 8;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.18, .24, 1.5, 7), trunkMat);
      trunk.position.set(x, .75, z);
      scene.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 7), leafMats[Math.abs(i) % 2]);
      crown.position.set(x, 1.9, z);
      crown.castShadow = true;
      scene.add(crown);
    }
  }
}


function createEnterableHouse() {
  // Exterior bungalow, placed in the open central city block.
  const house = new THREE.Group();
  house.position.set(8, 0, -11);
  scene.add(house);

  const wallMat = makeMaterial(0xe8d4b2);
  const trimMat = makeMaterial(0x72513c);
  const roofMat = makeMaterial(0x783f35);
  const floorMat = makeMaterial(0xb8a58a);

  addBox(house, 10, .18, 8, floorMat, 0, .09, 0);
  addBox(house, 10, 3.4, .35, wallMat, 0, 1.7, -4);
  addBox(house, .35, 3.4, 8, wallMat, -4.8, 1.7, 0);
  addBox(house, .35, 3.4, 8, wallMat, 4.8, 1.7, 0);

  // The front wall has a real opening for the doorway.
  addBox(house, 3.5, 3.4, .35, wallMat, -3.25, 1.7, 4);
  addBox(house, 3.5, 3.4, .35, wallMat, 3.25, 1.7, 4);
  addBox(house, 3, .35, .35, trimMat, 0, 3.05, 4);

  // Roof and simple front trim.
  addBox(house, 10.5, .35, 8.5, roofMat, 0, 3.55, 0);
  addBox(house, 1.15, 2.2, .12, trimMat, 0, 1.1, 4.2);

  // Exterior wall collision leaves the doorway open.
  cityObstacles.push(
    { minX: 3, maxX: 13, minZ: -15.2, maxZ: -14.8 },
    { minX: 2.9, maxX: 3.4, minZ: -15, maxZ: -7 },
    { minX: 12.6, maxX: 13.1, minZ: -15, maxZ: -7 },
    { minX: 3, maxX: 6.5, minZ: -7.2, maxZ: -6.8 },
    { minX: 9.5, maxX: 13, minZ: -7.2, maxZ: -6.8 }
  );

  // Interior: a living room and a second room.
  const inside = new THREE.Group();
  inside.position.set(interiorOrigin.x, 0, interiorOrigin.z);
  scene.add(inside);

  // Luxury jewel-toned interior palette.
  const insideFloor = makeMaterial(0x172554);
  const insideWall = makeMaterial(0x35105c);
  const insideTrim = makeMaterial(0xd4af37);
  const rubyMat = makeMaterial(0x9f1239);
  const emeraldMat = makeMaterial(0x047857);
  const blueMat = makeMaterial(0x1d4ed8);
  const rugMat = makeMaterial(0x701a75);

  addBox(inside, 12, .16, 10, insideFloor, 0, .08, 0);

  // Back and side walls.
  addBox(inside, 12, 3.2, .25, insideWall, 0, 1.6, -5);
  addBox(inside, .25, 3.2, 10, insideWall, -6, 1.6, 0);
  addBox(inside, .25, 3.2, 10, insideWall, 6, 1.6, 0);

  // Front wall with doorway opening.
  addBox(inside, 4.7, 3.2, .25, insideWall, -3.65, 1.6, 5);
  addBox(inside, 4.7, 3.2, .25, insideWall, 3.65, 1.6, 5);

  // Divider between the two rooms, leaving a central passage.
  addBox(inside, 4.8, 3.2, .22, insideWall, -3.6, 1.6, 0);
  addBox(inside, 4.8, 3.2, .22, insideWall, 3.6, 1.6, 0);

  // Living room: rich purple rug, ruby feature panel and gold trim.
  addBox(inside, 3.1, .045, 2.5, rugMat, -3.1, .19, 2.15);
  addBox(inside, 2.3, .65, .85, insideTrim, -3.6, .42, 2.2);
  addBox(inside, 2.15, 1.65, .07, rubyMat, -3.0, 1.65, -4.82);
  addBox(inside, 1.7, .09, .08, insideTrim, -3.0, 2.52, -4.79);
  addBox(inside, 1.7, .09, .08, insideTrim, -3.0, .78, -4.79);

  // Second room: emerald rug, royal-blue feature panel and gold trim.
  addBox(inside, 3.0, .045, 2.6, emeraldMat, 3.1, .19, -2.0);
  addBox(inside, 1.4, .35, 1.1, insideTrim, 3.5, .24, -2.1);
  addBox(inside, 1.7, .12, 1.4, blueMat, 3.5, .5, -2.1);
  addBox(inside, 2.25, 1.7, .07, blueMat, 3.0, 1.65, -4.82);
  addBox(inside, 1.8, .09, .08, insideTrim, 3.0, 2.53, -4.79);
  addBox(inside, 1.8, .09, .08, insideTrim, 3.0, .77, -4.79);

  // Interior collision boundaries, in world coordinates.
  const ox = interiorOrigin.x, oz = interiorOrigin.z;
  const addInteriorWall = (x1, x2, z1, z2) => {
    interiorObstacles.push({
      minX: ox + x1, maxX: ox + x2,
      minZ: oz + z1, maxZ: oz + z2
    });
  };

  addInteriorWall(-6.2, 6.2, -5.2, -4.8);
  addInteriorWall(-6.2, -5.8, -5, 5);
  addInteriorWall(5.8, 6.2, -5, 5);
  addInteriorWall(-6, -1.3, 4.8, 5.2);
  addInteriorWall(1.3, 6, 4.8, 5.2);
  addInteriorWall(-6, -1.2, -.14, .14);
  addInteriorWall(1.2, 6, -.14, .14);
}


function createGeneratedBuildingInterior() {
  const inside = new THREE.Group();
  const ox = generatedInteriorOrigin.x;
  const oz = generatedInteriorOrigin.z;
  inside.position.set(ox, 0, oz);
  scene.add(inside);

  const floor = makeMaterial(0x243047);
  const wall = makeMaterial(0x68758a);
  const trim = makeMaterial(0xd4af37);
  const rug = makeMaterial(0x6d28d9);
  const furniture = makeMaterial(0x8b5e3c);
  const H = 3.2, T = .25, W = 5, D = 4, doorW = 1.5;
  const side = (W * 2 - doorW) / 2;

  addBox(inside, W*2, .16, D*2, floor, 0, .08, 0);
  addBox(inside, W*2, H, T, wall, 0, H/2, -D);
  addBox(inside, T, H, D*2, wall, -W, H/2, 0);
  addBox(inside, T, H, D*2, wall, W, H/2, 0);
  addBox(inside, side, H, T, wall, -doorW/2-side/2, H/2, D);
  addBox(inside, side, H, T, wall, doorW/2+side/2, H/2, D);
  addBox(inside, doorW+.15, .14, .14, trim, 0, 2.45, D);
  addBox(inside, 3.4, .045, 2.4, rug, -1.7, .19, -.2);
  addBox(inside, 2.2, .65, .8, furniture, -1.7, .52, -1);
  addBox(inside, 1.1, .55, .8, trim, 2.5, .4, -1.8);
  addBox(inside, 2, 1.5, .08, trim, 0, 1.6, -3.82);

  const wallBox = (x1,x2,z1,z2) =>
    generatedInteriorObstacles.push({
      minX: ox+x1, maxX: ox+x2,
      minZ: oz+z1, maxZ: oz+z2
    });

  wallBox(-W,W,-D-T/2,-D+T/2);
  wallBox(-W-T/2,-W+T/2,-D,D);
  wallBox(W-T/2,W+T/2,-D,D);
  wallBox(-W,-doorW/2,D-T/2,D+T/2);
  wallBox(doorW/2,W,D-T/2,D+T/2);
}

function toggleHouse() {
  if (driving) {
    notify('Leave your car before entering a building.');
    return;
  }

  if (insideHouse) {
    const d = Math.hypot(
      player.position.x - interiorOrigin.x,
      player.position.z - (interiorOrigin.z + 5)
    );
    if (d > 3.2) {
      notify('Return to the bungalow doorway to leave.');
      return;
    }
    insideHouse = false;
    player.position.set(8, 0, -6.25);
    world.heading = 0;
    player.rotation.y = 0;
    $('house-button').textContent = 'ENTER HOUSE';
    $('location-text').textContent = 'DEMATRIX CITY';
    notify('You left the bungalow.');
    return;
  }

  if (insideGeneratedBuilding) {
    const d = Math.hypot(
      player.position.x - generatedInteriorOrigin.x,
      player.position.z - (generatedInteriorOrigin.z + 3.5)
    );
    if (d > 3) {
      notify('Return to the doorway to leave this building.');
      return;
    }
    insideGeneratedBuilding = false;
    if (generatedBuildingReturn) {
      player.position.set(generatedBuildingReturn.x, 0, generatedBuildingReturn.z);
    }
    generatedBuildingReturn = null;
    world.heading = 0;
    player.rotation.y = 0;
    $('house-button').textContent = 'ENTER HOUSE';
    $('location-text').textContent = 'DEMATRIX CITY';
    notify('You left the building.');
    return;
  }

  if (!insideHouse) {
    const distance = Math.hypot(
      player.position.x - houseDoor.x,
      player.position.z - houseDoor.z
    );

    if (distance > 4.5) {
      let nearest = null;
      let nearestDistance = Infinity;
      for (const b of generatedBuildings) {
        const d = Math.hypot(
          player.position.x - b.doorX,
          player.position.z - b.doorZ
        );
        if (d < nearestDistance) {
          nearest = b;
          nearestDistance = d;
        }
      }

      if (!nearest || nearestDistance > 3.5) {
        notify('Move close to a building doorway first.');
        return;
      }

      generatedBuildingReturn = {
        x: nearest.doorX,
        z: nearest.doorZ + .6
      };
      insideGeneratedBuilding = true;
      player.position.set(
        generatedInteriorOrigin.x, 0, generatedInteriorOrigin.z + 2.7
      );
      world.heading = 0;
      player.rotation.y = 0;
      $('house-button').textContent = 'EXIT BUILDING';
      $('location-text').textContent = 'BUILDING INTERIOR';
      notify('You entered the building. Return to the doorway to exit.');
      return;
    }

    insideHouse = true;
    player.position.set(interiorOrigin.x, 0, interiorOrigin.z + 3.8);
    world.heading = 0;
    player.rotation.y = world.heading;
    document.getElementById('house-button').textContent = 'EXIT HOUSE';
    document.getElementById('location-text').textContent = 'BUNGALOW INTERIOR';
    notify('Welcome inside! Explore both rooms.');
    return;
  }

  const doorDistance = Math.hypot(
    player.position.x - interiorOrigin.x,
    player.position.z - (interiorOrigin.z + 5)
  );

  if (doorDistance > 3.2) {
    notify('Return to the doorway to leave the house.');
    return;
  }

  insideHouse = false;
  player.position.set(8, 0, -6.25);
  world.heading = 0;
  player.rotation.y = world.heading;
  document.getElementById('house-button').textContent = 'ENTER HOUSE';
  document.getElementById('location-text').textContent = 'DEMATRIX CITY';
  notify('You left the bungalow.');
}


function makePlayer() {
  player = new THREE.Group();

  const skin = makeMaterial(0x9d674b);
  const shirt = makeMaterial(0x13b8a6);
  const pants = makeMaterial(0x253653);
  const shoes = makeMaterial(0x171b26);
  const hair = makeMaterial(0x302019);
  const eyes = makeMaterial(0xfafafa);
  const pupils = makeMaterial(0x171717);
  const mouthMat = makeMaterial(0x642e2a);

  function sphere(parent, radius, material, x, y, z, sx = 1, sy = 1, sz = 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 12, 10), material
    );
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function cylinder(parent, radiusTop, radiusBottom, height, material, x, y, z) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 10),
      material
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  // Rectangular torso, shoulders and hips.
  addBox(player, .72, .78, .40, shirt, 0, 1.34, 0);
  addBox(player, .88, .22, .43, shirt, 0, 1.68, 0);
  addBox(player, .53, .22, .34, pants, 0, .88, 0);

  // Neck and round head.
  cylinder(player, .12, .13, .20, skin, 0, 1.83, 0);
  sphere(player, .32, skin, 0, 2.17, 0, 1, 1.08, .94);

  // Hair cap and side locks.
  sphere(player, .32, hair, 0, 2.37, .015, 1.02, .47, 1);
  sphere(player, .13, hair, -.27, 2.24, .015, .5, .9, .8);
  sphere(player, .13, hair, .27, 2.24, .015, .5, .9, .8);

  // Face points forward along negative Z.
  for (const x of [-.115, .115]) {
    sphere(player, .052, eyes, x, 2.19, -.275, 1, 1, .45);
    sphere(player, .026, pupils, x, 2.19, -.300, 1, 1, .4);
  }
  sphere(player, .045, skin, 0, 2.105, -.302, .8, .8, .65);
  addBox(player, .13, .025, .025, mouthMat, 0, 2.035, -.295);

  // Pivoted cylindrical arms with rectangular hands.
  const leftArm = new THREE.Group();
  leftArm.position.set(-.48, 1.62, 0);
  player.add(leftArm);
  cylinder(leftArm, .105, .085, .43, shirt, 0, -.24, 0);
  cylinder(leftArm, .082, .065, .30, skin, 0, -.59, 0);
  addBox(leftArm, .17, .16, .16, skin, 0, -.77, -.015);

  const rightArm = new THREE.Group();
  rightArm.position.set(.48, 1.62, 0);
  player.add(rightArm);
  cylinder(rightArm, .105, .085, .43, shirt, 0, -.24, 0);
  cylinder(rightArm, .082, .065, .30, skin, 0, -.59, 0);
  addBox(rightArm, .17, .16, .16, skin, 0, -.77, -.015);

  // Pivoted cylindrical legs, round knees and rectangular shoes.
  function makeLeg(x) {
    const leg = new THREE.Group();
    leg.position.set(x, .82, 0);
    player.add(leg);

    cylinder(leg, .135, .105, .43, pants, 0, -.23, 0);
    sphere(leg, .105, pants, 0, -.45, 0);
    cylinder(leg, .085, .07, .30, pants, 0, -.59, 0);
    addBox(leg, .22, .14, .34, shoes, 0, -.78, -.065);
    return leg;
  }

  const leftLeg = makeLeg(-.19);
  const rightLeg = makeLeg(.19);

  player.userData.rig = { leftArm, rightArm, leftLeg, rightLeg };
  player.userData.gaitPhase = 0;
  player.position.set(0, 0, 3);
  scene.add(player);
}
const remotePlayers = new Map();
let socket = null;
let multiplayerJoined = false;
let multiplayerUsername = '';
let hasJoinedBefore = false;
let networkTimer = 0;

function makeRemotePlayer(data) {
  if (!data || !data.id || (socket && data.id === socket.id)) return;
  if (remotePlayers.has(data.id)) {
    updateRemotePlayer(data);
    return;
  }

  const root = new THREE.Group();
  const avatar = new THREE.Group();
  const car = new THREE.Group();

  const skin = makeMaterial(0xd29a78);
  const shirt = makeMaterial(0xf0a52f);
  const pants = makeMaterial(0x263d72);
  const dark = makeMaterial(0x20242b);
  const glass = makeMaterial(0x8ed9e9, .3);

  addBox(avatar, .65, .78, .36, shirt, 0, 1.25, 0);
  addBox(avatar, .22, .25, .25, skin, 0, 1.78, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.27, 12, 10), skin);
  head.position.set(0, 2.08, 0);
  head.castShadow = true;
  avatar.add(head);
  addBox(avatar, .15, .48, .16, skin, -.42, 1.25, 0);
  addBox(avatar, .15, .48, .16, skin, .42, 1.25, 0);
  addBox(avatar, .22, .55, .25, pants, -.17, .53, 0);
  addBox(avatar, .22, .55, .25, pants, .17, .53, 0);
  addBox(avatar, .24, .13, .32, dark, -.17, .22, -.04);
  addBox(avatar, .24, .13, .32, dark, .17, .22, -.04);

  addBox(car, 2.1, .65, 4.1, makeMaterial(0x8b65ed), 0, .72, 0);
  addBox(car, 1.55, .65, 1.95, glass, 0, 1.3, -.18);
  for (const x of [-1.08, 1.08]) {
    for (const z of [-1.25, 1.25]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(.42, .42, .22, 10), dark
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, .43, z);
      car.add(wheel);
    }
  }

  // A lightweight floating username label.
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(5, 12, 25, 0.78)";
  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 80, 20);
  ctx.fill();
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffe09a";
  ctx.fillText(String(data.username || "Player").slice(0, 20), 256, 48);

  const texture = new THREE.CanvasTexture(canvas);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false
  }));
  label.scale.set(3.2, .6, 1);
  label.position.y = 3.0;

  root.add(avatar, car, label);

  const startX = Number.isFinite(Number(data.x)) ? Number(data.x) : 0;
  const startZ = Number.isFinite(Number(data.z)) ? Number(data.z) : 0;
  const startHeading = Number.isFinite(Number(data.heading))
    ? Number(data.heading) : 0;

  root.position.set(startX, 0, startZ);
  root.rotation.y = startHeading;
  scene.add(root);

  remotePlayers.set(data.id, {
    root, avatar, car, label,
    targetX: startX,
    targetZ: startZ,
    targetHeading: startHeading
  });
  updateRemotePlayer(data);
}

function updateRemotePlayer(data) {
  const remote = remotePlayers.get(data.id);
  if (!remote) return;

  const x = Number(data.x);
  const z = Number(data.z);
  const heading = Number(data.heading);

  if (Number.isFinite(x)) remote.targetX = x;
  if (Number.isFinite(z)) remote.targetZ = z;
  if (Number.isFinite(heading)) remote.targetHeading = heading;

  remote.avatar.visible = !data.driving;
  remote.car.visible = !!data.driving;
}

function updateRemotePlayers(dt) {
  const alpha = 1 - Math.exp(-14 * Math.max(0, dt));

  for (const remote of remotePlayers.values()) {
    remote.root.position.x +=
      (remote.targetX - remote.root.position.x) * alpha;
    remote.root.position.z +=
      (remote.targetZ - remote.root.position.z) * alpha;

    const current = remote.root.rotation.y;
    const difference = Math.atan2(
      Math.sin(remote.targetHeading - current),
      Math.cos(remote.targetHeading - current)
    );
    remote.root.rotation.y = current + difference * alpha;
  }
}

function removeRemotePlayer(id) {
  const remote = remotePlayers.get(id);
  if (!remote) return;
  scene.remove(remote.root);
  remote.root.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        if (material.map) material.map.dispose();
        material.dispose();
      }
    }
  });
  remotePlayers.delete(id);
}

function refreshOnlineCount() {
  const el = document.getElementById("online-count");
  if (el) el.textContent = `${remotePlayers.size + (multiplayerJoined ? 1 : 0)} ONLINE`;
}

function makeFallbackCar() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x168fe5,
    metalness: 0.38,
    roughness: 0.35
  });

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x8bdcff,
    metalness: 0.15,
    roughness: 0.2,
    transparent: true,
    opacity: 0.78
  });

  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x20242b,
    roughness: 0.85
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.25, 0.65, 3.1),
    bodyMat
  );
  body.position.y = 0.75;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.65, 0.72, 1.65),
    glassMat
  );
  cabin.position.set(0, 1.38, -0.12);
  cabin.castShadow = true;
  group.add(cabin);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.12, 1.45),
    bodyMat
  );
  roof.position.set(0, 1.79, -0.12);
  roof.castShadow = true;
  group.add(roof);

  for (const x of [-1.08, 1.08]) {
    for (const z of [-1.05, 1.05]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.22, 14),
        wheelMat
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.43, z);
      wheel.castShadow = true;
      group.add(wheel);
    }
  }

  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xfff1b0,
    emissive: 0x665522
  });
  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0xff2525,
    emissive: 0x661010
  });

  for (const x of [-0.72, 0.72]) {
    const headlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.16, 0.06),
      headlightMat
    );
    headlight.position.set(x, 0.82, 1.57);
    group.add(headlight);

    const taillight = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.16, 0.06),
      taillightMat
    );
    taillight.position.set(x, 0.82, -1.57);
    group.add(taillight);
  }

  return group;
}

function makeVehicle() {
  vehicles.length = 0;

  // Create five independently usable cars around the city.
  const spawns = [
    [4, 2],
    [-8, 2],
    [12, -8],
    [-12, -8],
    [4, 14]
  ];

  for (let i = 0; i < spawns.length; i++) {
    const car = new THREE.Group();
    car.position.set(spawns[i][0], 0, spawns[i][1]);
    car.rotation.y = i === 0 ? 0 : Math.PI * 0.5;
    car.userData.vehicleId = i + 1;
    car.userData.vehicleName = `City Car ${i + 1}`;

    const model = makeFallbackCar();
    car.add(model);
    scene.add(car);
    vehicles.push(car);
  }

  vehicle = vehicles[0];
  vehicleModel = vehicle.children[0];

  const loader = new FBXLoader();

  loader.load('/assets/cars/Cars.fbx', model => {
    try {
      model.updateMatrixWorld(true);

      // Select one named vehicle, not the complete three-car collection.
      const selected = model.getObjectByName('Car_01');

      if (!selected) {
        console.error('Car_01 not found in Cars.fbx');
        notify('Car_01 was not found; keeping fallback car.');
        return;
      }

      selected.updateWorldMatrix(true, true);

      const car = selected.clone(true);

      // Preserve the selected object's transforms from its original hierarchy.
      car.position.set(0, 0, 0);
      car.rotation.set(0, 0, 0);
      car.scale.set(1, 1, 1);
      car.updateMatrix();
      car.applyMatrix4(selected.matrixWorld);

      // If the chosen group contains other named cars, remove those subgroups.
      const unwanted = [];
      car.traverse(obj => {
        if (obj !== car && /^Car_0[23]$/.test(obj.name)) {
          unwanted.push(obj);
        }
      });
      for (const obj of unwanted) {
        if (obj.parent) obj.parent.remove(obj);
      }

      const asset = new THREE.Group();
      asset.add(car);
      asset.updateMatrixWorld(true);

      let bounds = new THREE.Box3().setFromObject(asset);
      let size = bounds.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      if (!Number.isFinite(maxDim) || maxDim <= 0) {
        throw new Error('Car_01 has invalid dimensions');
      }

      asset.scale.setScalar(3.8 / maxDim);
      asset.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(asset);

      const center = bounds.getCenter(new THREE.Vector3());
      asset.position.x -= center.x;
      asset.position.y -= bounds.min.y;
      asset.position.z -= center.z;
      asset.rotation.y = Math.PI; // Align car nose with game-forward.

      asset.traverse(obj => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });

      vehicle.remove(vehicleModel);
      vehicleModel = asset;
      vehicle.add(asset);

      // Give every other usable car the loaded 3D model too.
      for (const otherCar of vehicles) {
        if (otherCar === vehicle) continue;

        while (otherCar.children.length) {
          otherCar.remove(otherCar.children[0]);
        }
        otherCar.add(asset.clone(true));
      }

      console.log('Loaded car model for', vehicles.length, 'usable cars.',
        model.children.map(child => child.name));
      notify('Low-poly Car_01 loaded.');
    } catch (error) {
      console.error('Could not prepare Car_01:', error);
      notify('Car model issue; keeping fallback car.');
    }
  }, undefined, error => {
    console.error('FBX load failed; keeping fallback car.', error);
    notify('FBX failed to load; using fallback car.');
  });
}
function makePlane() {
  plane = new THREE.Group();
  plane.position.set(7, 0, 5);
  scene.add(plane);

  const loader = new FBXLoader();
  const textureLoader = new THREE.TextureLoader();

  textureLoader.load('/assets/plane/Plane_diffuse.png', texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    loader.load('/assets/plane/LowPolyPlane01.FBX', model => {
      model.traverse(object => {
        if (!object.isMesh) return;
        object.material = object.material.clone();
        object.material.map = texture;
        object.material.needsUpdate = true;
        object.castShadow = true;
        object.receiveShadow = true;
      });

      const originalBox = new THREE.Box3().setFromObject(model);
      const size = originalBox.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z);

      if (maxDimension > 0) model.scale.setScalar(8 / maxDimension);

      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -box.min.y, -center.z);
      plane.add(model);

      console.log('Low-poly plane loaded successfully.');
      notify('Plane ready. Find it near the city spawn.');
    }, undefined, error => {
      console.error('Plane FBX failed:', error);
      notify('Plane model failed to load.');
    });
  }, undefined, error => {
    console.error('Plane texture failed:', error);
    notify('Plane texture failed to load.');
  });
}
function init() {
  scene = new THREE.Scene();
  clock = new THREE.Clock();
  camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, .1, 500);
  camera.position.set(0, 7, 12);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  $('game').prepend(renderer.domElement);

  makeCity();
  createEnterableHouse();
  createGeneratedBuildingInterior();
  makePlayer();
  makeVehicle();
  makePlane();
  createEquipmentSpots();
  createAIBots();
  statusText.textContent = 'WORLD READY';
  loadingMessage.textContent = 'City ready. Enter the world!';
  loading.classList.add('hidden');
  setTimeout(() => { loading.style.display = 'none'; }, 600);
  notify('Welcome to Dematrix City.');
  animate();
}

function isBlockedAt(x, z, radius = 0.45) {
  const obstacles = insideHouse
    ? interiorObstacles
    : insideGeneratedBuilding
      ? generatedInteriorObstacles
      : cityObstacles;
  for (const b of obstacles) {
    if (
      x + radius > b.minX && x - radius < b.maxX &&
      z + radius > b.minZ && z - radius < b.maxZ
    ) return true;
  }
  return false;
}

function moveEntity(entity, forward, turn, dt, maxSpeed) {
  world.heading -= turn * dt * 2.1;
  entity.rotation.y = world.heading;

  const targetSpeed = forward * maxSpeed;
  world.speed += (targetSpeed - world.speed) * Math.min(1, dt * 3.5);

  const radius = entity === vehicle ? 1.45 : 0.42;
  const dx = -Math.sin(world.heading) * world.speed * dt;
  const dz = -Math.cos(world.heading) * world.speed * dt;

  // Resolve axes separately so the player can slide along a wall.
  const nextX = entity.position.x + dx;
  if (!isBlockedAt(nextX, entity.position.z, radius)) {
    entity.position.x = nextX;
  }

  const nextZ = entity.position.z + dz;
  if (!isBlockedAt(entity.position.x, nextZ, radius)) {
    entity.position.z = nextZ;
  }
}

function updatePlane(dt, forward, turn) {
  if (!plane) return;

  const climbing = keys.has('r') || keys.has('climb');
  const descending = keys.has('v') || keys.has('descend');

  planeSpeed += forward * 12 * dt;
  planeSpeed = Math.max(0, Math.min(32, planeSpeed));
  if (forward === 0) planeSpeed = Math.max(0, planeSpeed - 2 * dt);

  plane.rotation.y -= turn * dt * (0.45 + planeSpeed * 0.025);

  if (plane.position.y <= 0.5) {
    plane.position.y = 0.5;
    planeVerticalSpeed = 0;
    if (climbing && planeSpeed > 7) planeVerticalSpeed = 5;
  } else {
    if (climbing) planeVerticalSpeed = Math.min(8, planeVerticalSpeed + 8 * dt);
    else if (descending) planeVerticalSpeed = Math.max(-8, planeVerticalSpeed - 10 * dt);
    else planeVerticalSpeed -= 1.5 * dt;
  }

  const nextY = Math.max(0.5, Math.min(100, plane.position.y + planeVerticalSpeed * dt));
  const nextX = plane.position.x + Math.sin(plane.rotation.y) * planeSpeed * dt;
  const nextZ = plane.position.z + Math.cos(plane.rotation.y) * planeSpeed * dt;
  const planeRadius = 2.2;
  let planeBlocked = false;

  // Check generated buildings, including their actual heights.
  for (const b of generatedBuildings) {
    const overlapsXZ =
      nextX + planeRadius > b.x - b.w / 2 &&
      nextX - planeRadius < b.x + b.w / 2 &&
      nextZ + planeRadius > b.z - b.d / 2 &&
      nextZ - planeRadius < b.z + b.d / 2;

    if (overlapsXZ && nextY < b.h + 1) {
      planeBlocked = true;
      break;
    }
  }

  // Check the separate enterable house and its roof.
  const overlapsHouse =
    nextX + planeRadius > 2.5 &&
    nextX - planeRadius < 13.5 &&
    nextZ + planeRadius > -15.5 &&
    nextZ - planeRadius < -6.5;

  if (overlapsHouse && nextY < 4.8) {
    planeBlocked = true;
  }

  if (planeBlocked) {
    planeSpeed = 0;
    planeVerticalSpeed = 0;
  } else {
    plane.position.x = nextX;
    plane.position.z = nextZ;
    plane.position.y = nextY;
  }

  player.visible = false;
  const behind = cameraMode % 2 === 0 ? 1 : -1;
  tempV.set(
    plane.position.x + Math.sin(plane.rotation.y) * 12 * behind,
    plane.position.y + 7,
    plane.position.z + Math.cos(plane.rotation.y) * 12 * behind
  );
  camera.position.lerp(tempV, Math.min(1, dt * 3));
  camera.lookAt(plane.position.x, plane.position.y + 1, plane.position.z);

  $('speed').textContent = Math.round(planeSpeed * 5);
  $('location-text').textContent =
    `AIR ${Math.round(plane.position.x)}, ${Math.round(plane.position.y)}, ${Math.round(plane.position.z)}`;
  $('mode-title').textContent = 'Flying the plane';
  $('mode-info').textContent = 'Forward to accelerate • R climb • V descend';
  $('enter-button').textContent = 'EXIT PLANE';
}

function togglePlane() {
  if (flyingPlane) {
    if (plane.position.y > 1.2) {
      notify('Descend and land before exiting the plane.');
      return;
    }

    flyingPlane = false;
    stopVehicleMusic();
    planeSpeed = 0;
    player.position.set(plane.position.x + 2, 0, plane.position.z);
    player.visible = true;
    world.heading = plane.rotation.y;
    $('speed').textContent = '0';
    $('enter-button').textContent = 'ENTER CAR';
    notify('Exited the plane.');
    return;
  }

  if (driving || insideHouse || insideGeneratedBuilding) {
    notify('Exit your current vehicle or building first.');
    return;
  }

  if (!plane) {
    notify('The plane is still loading. Try again shortly.');
    return;
  }

  const distance = Math.hypot(
    player.position.x - plane.position.x,
    player.position.z - plane.position.z
  );

  if (distance > 10) {
    notify('Move closer to the plane first.');
    return;
  }

  flyingPlane = true;
  startVehicleMusic();
  planeSpeed = 0;
  planeVerticalSpeed = 0;
  player.visible = false;
  notify('Plane controls ready. Hold forward to accelerate.');
}
function update(dt) {
  const forward = (keys.has('forward') || keys.has('w') ? 1 : 0) -
    (keys.has('back') || keys.has('s') ? 1 : 0);
  const turn = (keys.has('right') || keys.has('d') ? 1 : 0) -
    (keys.has('left') || keys.has('a') ? 1 : 0);

  if (flyingPlane) {
    updatePlane(dt, forward, turn);
    return;
  }

  if (driving) {
    moveEntity(vehicle, forward, turn, dt, 12);
    player.position.copy(vehicle.position);
    player.visible = false;
    world.carHeading = world.heading;
    $('speed').textContent = Math.round(Math.abs(world.speed) * 5);
  } else {
    world.speed = 0;
    moveEntity(player, forward, turn, dt, running ? 30 : 17);
    player.visible = true;
    $('speed').textContent = '0';
  }

  if (!insideHouse && !insideGeneratedBuilding) stepAIBots(dt);

  if (!driving && player.userData.rig) {
    const rig = player.userData.rig;
    const moving = forward !== 0;
    const pace = running ? 22 : 14;
    player.userData.gaitPhase += dt * pace;

    const swing = moving ? Math.sin(player.userData.gaitPhase) * (running ? .85 : .58) : 0;
    rig.leftLeg.rotation.x = swing;
    rig.rightLeg.rotation.x = -swing;
    rig.leftArm.rotation.x = -swing * .75;
    rig.rightArm.rotation.x = swing * .75;
    rig.leftLeg.rotation.z = 0;
    rig.rightLeg.rotation.z = 0;
    rig.leftArm.rotation.z = 0;
    rig.rightArm.rotation.z = 0;

    if (!moving) {
      rig.leftArm.rotation.x *= .15;
      rig.rightArm.rotation.x *= .15;
      rig.leftLeg.rotation.x *= .15;
      rig.rightLeg.rotation.x *= .15;
    }
  }

  if (multiplayerJoined && socket && socket.connected) {
    networkTimer += dt;
    if (networkTimer >= 0.05) {
      networkTimer = 0;
      const netEntity = driving ? vehicle : player;
      socket.emit('player:update', {
        x: netEntity.position.x,
        z: netEntity.position.z,
        heading: netEntity.rotation.y,
        driving
      });
    }
  }

  const active = driving ? vehicle : player;
  const behind = cameraMode % 2 === 0 ? 1 : -1;
  tempV.set(
    active.position.x + Math.sin(active.rotation.y) * 9 * behind,
    active.position.y + (driving ? 5.4 : 4.8),
    active.position.z + Math.cos(active.rotation.y) * 9 * behind
  );
  camera.position.lerp(tempV, Math.min(1, dt * 4));
  const lookAt = active.position.clone();
  lookAt.y += driving ? 1 : 1.3;
  camera.lookAt(lookAt);

  const px = Math.round(active.position.x);
  const pz = Math.round(active.position.z);
  $('location-text').textContent = `CITY ${px}, ${pz}`;
  $('mode-title').textContent = driving ? 'Driving around' : 'Explore the city';
  $('mode-info').textContent = driving ? 'Use the arrows to steer your car.' : 'Walk around or approach your car.';
  $('enter-button').textContent = driving ? 'EXIT CAR' : 'ENTER CAR';
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  update(dt);
  updateRemotePlayers(dt);
  renderer.render(scene, camera);
}

function toggleVehicle() {
  if (driving) {
    const exitedCar = vehicle;
    driving = false;
    stopVehicleMusic();

    // Step out beside the car, on a clear side if possible.
    const sideX = exitedCar.position.x + Math.cos(exitedCar.rotation.y) * 2.5;
    const sideZ = exitedCar.position.z - Math.sin(exitedCar.rotation.y) * 2.5;

    if (!isBlockedAt(sideX, sideZ, 0.45)) {
      player.position.set(sideX, 0, sideZ);
    } else {
      player.position.set(
        exitedCar.position.x - Math.cos(exitedCar.rotation.y) * 2.5,
        0,
        exitedCar.position.z + Math.sin(exitedCar.rotation.y) * 2.5
      );
    }

    world.heading = exitedCar.rotation.y;
    notify(`Exited ${exitedCar.userData.vehicleName || 'vehicle'}.`);
    return;
  }

  let nearestCar = null;
  let nearestDistance = Infinity;

  for (const car of vehicles) {
    const distance = Math.hypot(
      player.position.x - car.position.x,
      player.position.z - car.position.z
    );

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestCar = car;
    }
  }

  if (!nearestCar || nearestDistance > 9) {
    notify('Move closer to one of the city cars first.');
    return;
  }

  vehicle = nearestCar;
  driving = true;
  startVehicleMusic();
  world.heading = vehicle.rotation.y;
  world.carHeading = vehicle.rotation.y;
  notify(`Entered ${vehicle.userData.vehicleName || 'vehicle'}. Drive safely!`);
}


function attackNearbyBot() {
  const now = performance.now();
  if (now - lastAttackAt < 550) return;
  lastAttackAt = now;

  if (driving) {
    notify('Exit your vehicle before attacking.');
    return;
  }
  if (insideHouse || insideGeneratedBuilding) {
    notify('You cannot attack inside a building.');
    return;
  }


  if (socket && multiplayerJoined) {
    let targetId = null;
    let nearestPlayer = Infinity;

    for (const [id, remote] of remotePlayers) {
      const dx = remote.root.position.x - player.position.x;
      const dz = remote.root.position.z - player.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.001 || distance > 2.8 ||
          distance >= nearestPlayer) continue;

      const facing = (dx * -Math.sin(world.heading) +
                      dz * -Math.cos(world.heading)) / distance;
      if (facing < 0.15) continue;

      nearestPlayer = distance;
      targetId = id;
    }

    if (targetId) {
      socket.emit("player:punch", { targetId });
      return;
    }
  }

  const fx = -Math.sin(world.heading);
  const fz = -Math.cos(world.heading);
  let targetBot = null;
  let nearest = Infinity;

  for (const bot of aiBots) {
    const dx = bot.root.position.x - player.position.x;
    const dz = bot.root.position.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 2.8 || distance < 0.001) continue;

    const facing = (dx * fx + dz * fz) / distance;
    if (facing < 0.15 || distance >= nearest) continue;

    nearest = distance;
    targetBot = bot;
  }

  if (!targetBot) {
    notify('No citizen in reach. Face an NPC and move closer.');
    return;
  }

  const dx = targetBot.root.position.x - player.position.x;
  const dz = targetBot.root.position.z - player.position.z;
  const distance = Math.max(0.001, Math.hypot(dx, dz));
  const radius = targetBot.kind === 'driver' ? 1.45 : 0.32;

  const nextX = targetBot.root.position.x + dx / distance;
  const nextZ = targetBot.root.position.z + dz / distance;

  if (!isBlockedAt(nextX, targetBot.root.position.z, radius)) {
    targetBot.root.position.x = nextX;
  }
  if (!isBlockedAt(targetBot.root.position.x, nextZ, radius)) {
    targetBot.root.position.z = nextZ;
  }

  chooseAIDestination(targetBot);
  notify(targetBot.kind === 'driver'
    ? 'You struck the driver!'
    : 'You punched the citizen!');
}

function bindHold(button, action) {
  const start = e => { e.preventDefault(); held.add(action); keys.add(action); };
  const stop = e => { e.preventDefault(); held.delete(action); keys.delete(action); };
  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('lostpointercapture', stop);
  button.addEventListener('contextmenu', e => e.preventDefault());
}

document.querySelectorAll('[data-action]').forEach(button => {
  const action = button.dataset.action;
  if (['forward', 'back', 'left', 'right', 'climb', 'descend'].includes(action)) {
    bindHold(button, action);
  } else {
    button.addEventListener('click', () => {
      if (action === 'enter') { if (flyingPlane) togglePlane(); else toggleVehicle(); }
      if (action === 'plane') togglePlane();
      if (action === 'house') toggleHouse();
      if (action === 'attack') attackNearbyBot();
      if (action === 'run') {
        running = !running;
        button.textContent = `RUN: ${running ? 'ON' : 'OFF'}`;
      }
      if (action === 'camera') {
        cameraMode++;
        notify(cameraMode % 2 ? 'Reverse camera view.' : 'Follow camera view.');
      }
    });
  }
});

addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' '].includes(key)) e.preventDefault();
  if (key.startsWith('arrow')) {
    keys.add(({arrowup:'forward',arrowdown:'back',arrowleft:'left',arrowright:'right'})[key]);
  } else keys.add(key);
  if (key === 'e' && !e.repeat) toggleVehicle();
  if (key === 'q' && !e.repeat) togglePlane();
  if (key === 'f' && !e.repeat) attackNearbyBot();
  if (key === 'shift') running = true;
});
addEventListener('keyup', e => {
  const key = e.key.toLowerCase();
  keys.delete(key);
  if (key.startsWith('arrow')) keys.delete(({arrowup:'forward',arrowdown:'back',arrowleft:'left',arrowright:'right'})[key]);
  if (key === 'shift') running = false;
});
addEventListener('blur', () => { keys.clear(); held.clear(); });
addEventListener('resize', () => {
  if (!renderer || !camera) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
});

socket = io();
import('./voice.js').then(({ initVoiceChat }) => {
  initVoiceChat(socket, remotePlayers, () => multiplayerJoined);
}).catch(error => {
  console.error('[Voice] Could not load voice module:', error);
  const status = document.getElementById('voice-status');
  if (status) status.textContent = 'Voice module failed to load';
});


socket.on('connect', () => {
  console.log('[DeMatrix] Socket connected:', socket.id);
  const message = document.getElementById('connection-message');

  if (multiplayerUsername && hasJoinedBefore) {
    if (message) message.textContent =
      'Connection restored. Rejoining the city…';
    socket.emit('player:join', { username: multiplayerUsername });
    return;
  }

  if (message) message.textContent =
    'Server connected. Choose your username.';
});

socket.on('connect_error', (error) => {
  console.error('[DeMatrix] Socket connection failed:', error);
  const message = document.getElementById('connection-message');
  if (message) {
    message.textContent = 'Connection failed: ' + (error?.message || 'unknown error');
  }
});

socket.on('disconnect', (reason) => {
  console.warn('[DeMatrix] Socket disconnected:', reason);
  multiplayerJoined = false;

  for (const id of [...remotePlayers.keys()]) {
    removeRemotePlayer(id);
  }
  refreshOnlineCount();

  const message = document.getElementById('connection-message');
  if (message) {
    message.textContent = multiplayerUsername
      ? 'Connection lost. Reconnecting to the city…'
      : 'Disconnected: ' + reason;
  }
  if (statusText) statusText.textContent = 'RECONNECTING';
});

document.getElementById('join-form')?.addEventListener('submit', event => {
  event.preventDefault();
  if (!socket.connected) {
    notify('Multiplayer server is not connected yet.');
    return;
  }
  const input = document.getElementById('username-input');
  const username = String(input?.value || '').trim().slice(0, 20);
  if (!username) return;

  multiplayerUsername = username;
  hasJoinedBefore = true;
  socket.emit('player:join', { username: multiplayerUsername });
});

socket.on('player:welcome', data => {
  const wasJoined = multiplayerJoined;
  multiplayerJoined = true;

  for (const id of [...remotePlayers.keys()]) {
    removeRemotePlayer(id);
  }
  for (const other of (data.players || [])) {
    makeRemotePlayer(other);
  }

  document.getElementById('username-screen')?.classList.add('hidden');
  if (statusText) statusText.textContent = 'MULTIPLAYER ONLINE';

  const message = document.getElementById('connection-message');
  if (message) message.textContent = 'Connected to the multiplayer city.';

  notify(wasJoined
    ? 'Connection restored. You are back in the city!'
    : 'Welcome to the multiplayer city!');
  refreshOnlineCount();
});

socket.on('player:joined', data => {
  makeRemotePlayer(data);
  refreshOnlineCount();
  notify(`${data.username || 'A player'} joined the city.`);
});

socket.on('player:moved', data => updateRemotePlayer(data));
socket.on('player:punch:result', data => {
  if (data?.message) notify(data.message);
});

socket.on('player:hit', data => {
  if (Number.isFinite(data?.x) && Number.isFinite(data?.z)) {
    player.position.x = data.x;
    player.position.z = data.z;
  }
  notify('You were punched by ' + (data?.username || 'another player') + '!');
});


socket.on('player:left', id => {
  const remote = remotePlayers.get(id);
  const name = remote?.label?.material?.map ? 'A player' : 'A player';
  removeRemotePlayer(id);
  refreshOnlineCount();
});





// ----- Autonomous city population -----

function randomRoadCoordinate() {
  return (Math.floor(Math.random() * 9) - 4) * 22;
}

function chooseAIDestination(bot) {
  const current = bot.root.position;
  const target = randomRoadCoordinate();

  // Travel along one road axis at a time rather than cutting across blocks.
  if (Math.random() < 0.5) {
    let z = target;
    if (Math.abs(z - current.z) < 10) {
      z = Math.max(-88, Math.min(88, z + (z >= 0 ? -22 : 22)));
    }
    bot.target.set(current.x, 0, z);
  } else {
    let x = target;
    if (Math.abs(x - current.x) < 10) {
      x = Math.max(-88, Math.min(88, x + (x >= 0 ? -22 : 22)));
    }
    bot.target.set(x, 0, current.z);
  }
  bot.blockedTime = 0;
}


function makeAIPedestrian() {
  const root = new THREE.Group();

  const skin = makeMaterial(0x9b6044);
  const shirtColors = [
    0xff3434, 0x00d5ff, 0xffcf24,
    0xf45cff, 0x35f28b, 0xffffff
  ];
  const shirt = makeMaterial(
    shirtColors[Math.floor(Math.random() * shirtColors.length)]
  );
  const trousers = makeMaterial(0x263754);
  const shoes = makeMaterial(0x161b25);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 12, 10), skin
  );
  head.position.y = 1.83;
  head.castShadow = true;
  root.add(head);

  // Bright torso, visible even at a distance.
  addBox(root, 0.56, 0.68, 0.34, shirt, 0, 1.25, 0);

  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.34, 1.51, 0);
    root.add(arm);
    addBox(arm, 0.16, 0.55, 0.17, shirt, 0, -0.26, 0);
    addBox(arm, 0.15, 0.15, 0.15, skin, 0, -0.58, 0);
    arms.push(arm);
  }

  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.15, 0.88, 0);
    root.add(leg);
    addBox(leg, 0.19, 0.48, 0.21, trousers, 0, -0.23, 0);
    addBox(leg, 0.21, 0.13, 0.31, shoes, 0, -0.49, -0.045);
    legs.push(leg);
  }

  // A bright ground marker helps players spot citizens.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.52, 20),
    new THREE.MeshBasicMaterial({
      color: 0x42ffb0,
      side: THREE.DoubleSide
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  root.add(ring);

  // Floating citizen label; generated locally, no image download required.
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(5, 15, 30, 0.88)";
    ctx.fillRect(4, 4, 248, 56);
    ctx.strokeStyle = "#42ffb0";
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 56);
    ctx.font = "bold 25px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("CITY CITIZEN", 128, 40);

    const texture = new THREE.CanvasTexture(canvas);
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false
      })
    );
    label.position.y = 2.65;
    label.scale.set(2.4, 0.6, 1);
    root.add(label);
  } catch (error) {
    console.warn("Citizen labels unavailable:", error);
  }

  root.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  root.userData.walkParts = { arms, legs, phase: Math.random() * 6.28 };
  return root;
}

function createAIBots() {
  if (aiBots.length) return;

  // Walking citizens.
  for (let i = 0; i < 18; i++) {
    const root = makeAIPedestrian();
    const nearbySpawns = [
      [-6, -10], [6, -10], [-6, 10],
      [6, 10], [0, -13], [0, 13]
    ];
    if (i < nearbySpawns.length) {
      root.position.set(nearbySpawns[i][0], 0, nearbySpawns[i][1]);
    } else {
      root.position.set(randomRoadCoordinate(), 0, randomRoadCoordinate());
    }
    scene.add(root);

    const bot = {
      kind: "walker",
      root,
      target: new THREE.Vector3(),
      heading: Math.random() * Math.PI * 2,
      speed: 2.0 + Math.random() * 0.7,
      blockedTime: 0
    };
    aiBots.push(bot);
    chooseAIDestination(bot);
  }

  // Independent drivers with their own vehicles and steering.
  for (let i = 0; i < 6; i++) {
    const root = new THREE.Group();
    root.add(makeFallbackCar());
    root.position.set(randomRoadCoordinate(), 0, randomRoadCoordinate());
    scene.add(root);

    const bot = {
      kind: "driver",
      root,
      target: new THREE.Vector3(),
      heading: Math.random() * Math.PI * 2,
      speed: 5.0 + Math.random() * 1.5,
      blockedTime: 0
    };
    aiBots.push(bot);
    chooseAIDestination(bot);
  }

  console.log("Autonomous citizens created:", aiBots.length);
  notify("City life is active: pedestrians and AI drivers are moving.");
}

function stepAIBots(dt) {
  for (const bot of aiBots) {
    const pos = bot.root.position;
    let dx = bot.target.x - pos.x;
    let dz = bot.target.z - pos.z;
    let distance = Math.hypot(dx, dz);

    if (distance < 1.8) {
      chooseAIDestination(bot);
      dx = bot.target.x - pos.x;
      dz = bot.target.z - pos.z;
      distance = Math.hypot(dx, dz);
    }

    // Movement convention matches the player's forward direction.
    const desired = Math.atan2(-dx, -dz);
    let difference = desired - bot.heading;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;

    const turnRate = bot.kind === "driver" ? 1.8 : 2.7;
    bot.heading += Math.max(
      -turnRate * dt, Math.min(turnRate * dt, difference)
    );
    bot.root.rotation.y = bot.heading;

    if (bot.kind === "walker" && bot.root.userData.walkParts) {
      const parts = bot.root.userData.walkParts;
      parts.phase += dt * 7;
      const swing = Math.sin(parts.phase) * 0.62;
      parts.legs[0].rotation.x = swing;
      parts.legs[1].rotation.x = -swing;
      parts.arms[0].rotation.x = -swing * 0.7;
      parts.arms[1].rotation.x = swing * 0.7;
    }

    const step = Math.min(bot.speed * dt, distance);
    const mx = -Math.sin(bot.heading) * step;
    const mz = -Math.cos(bot.heading) * step;
    const radius = bot.kind === "driver" ? 1.45 : 0.32;
    let moved = false;

    const nx = pos.x + mx;
    if (!isBlockedAt(nx, pos.z, radius)) {
      pos.x = nx;
      moved = true;
    }

    const nz = pos.z + mz;
    if (!isBlockedAt(pos.x, nz, radius)) {
      pos.z = nz;
      moved = true;
    }

    if (moved) {
      bot.blockedTime = 0;
    } else {
      bot.blockedTime += dt;
      if (bot.blockedTime > 0.65) chooseAIDestination(bot);
    }
  }
}


// Martins DeMatrix live city map and visible equipment markers.
const equipmentSpots = [
  { id: "gun-north", kind: "GUN", x: -44, z: -48 },
  { id: "gun-south", kind: "GUN", x: 44, z: 48 },
  { id: "sword-east", kind: "SWORD", x: 48, z: -22 },
  { id: "sword-west", kind: "SWORD", x: -48, z: 22 }
];

function createEquipmentSpots() {
  for (const spot of equipmentSpots) {
    const group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({
      color: spot.kind === "GUN" ? 0x303945 : 0xd5e4f3,
      metalness: .72,
      roughness: .3,
      emissive: spot.kind === "GUN" ? 0x29100e : 0x17102b,
      emissiveIntensity: .22
    });
    const grip = new THREE.MeshStandardMaterial({
      color: spot.kind === "GUN" ? 0xff786e : 0xc8a4ff,
      metalness: .25,
      roughness: .55,
      emissive: spot.kind === "GUN" ? 0x5a100a : 0x29104a,
      emissiveIntensity: .3
    });

    if (spot.kind === "GUN") {
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(.72, .13, .16), metal);
      barrel.position.set(.08, .28, 0);
      group.add(barrel);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(.17, .28, .15), grip);
      handle.position.set(-.15, .12, 0);
      handle.rotation.z = -.2;
      group.add(handle);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(.12, .07, .12), grip);
      sight.position.set(.05, .37, 0);
      group.add(sight);
    } else {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(.13, .75, .09), metal);
      blade.position.set(0, .53, 0);
      group.add(blade);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(.34, .08, .13), grip);
      guard.position.set(0, .15, 0);
      group.add(guard);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(.1, .3, .1), grip);
      handle.position.set(0, -.02, 0);
      group.add(handle);
    }

    group.position.set(spot.x, .12, spot.z);
    group.rotation.y = spot.kind === "GUN" ? .5 : -.35;
    group.userData.equipmentSpot = spot.id;
    scene.add(group);
    spot.object = group;
  }
}

const minimapCanvas = document.getElementById("minimap");
const minimapContext = minimapCanvas ? minimapCanvas.getContext("2d") : null;
const mapPanel = document.getElementById("minimap-panel");
const mapPlayersLabel = document.getElementById("map-players");
const MAP_RANGE = 112;

function drawMinimap() {
  if (!minimapContext || !minimapCanvas) return;
  const ctx = minimapContext;
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const scale = w / (MAP_RANGE * 2);
  const point = (x, z) => ({ x: cx + x * scale, y: cy + z * scale });

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#102337";
  ctx.fillRect(0, 0, w, h);

  // These grid lines match the procedural city's 22-unit road spacing.
  ctx.strokeStyle = "#687d8d";
  ctx.lineWidth = 5;
  for (let n = -4; n <= 4; n++) {
    const road = n * 22;
    const px = point(road, 0).x;
    const py = point(0, road).y;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
  }

  ctx.strokeStyle = "#a8c4d6";
  ctx.lineWidth = 1;
  ctx.strokeRect(.5, .5, w - 1, h - 1);

  // Equipment symbols correspond to the actual props created in the world.
  for (const spot of equipmentSpots) {
    const p = point(spot.x, spot.z);
    ctx.fillStyle = spot.kind === "GUN" ? "#ff786e" : "#c8a4ff";
    ctx.beginPath();
    if (spot.kind === "GUN") {
      ctx.fillRect(p.x - 5, p.y - 2, 10, 4);
      ctx.fillRect(p.x - 2, p.y + 1, 3, 5);
    } else {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-Math.PI / 4);
      ctx.fillRect(-2, -7, 4, 14);
      ctx.fillRect(-5, 1, 10, 2);
      ctx.restore();
    }
  }

  // Other players use the same world positions received from Socket.IO.
  let visiblePlayers = 0;
  for (const remote of remotePlayers.values()) {
    const root = remote.root;
    if (!root) continue;
    const p = point(root.position.x, root.position.z);
    ctx.fillStyle = "#4de7ff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    visiblePlayers++;
  }
  if (mapPlayersLabel) {
    mapPlayersLabel.textContent = `${visiblePlayers + (player ? 1 : 0)} PLAYERS`;
  }

  if (player) {
    const subject = driving && vehicle ? vehicle : player;
    const p = point(subject.position.x, subject.position.z);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(world.heading);
    ctx.fillStyle = "#ffe06b";
    ctx.strokeStyle = "#fff7d1";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

const hudToggle = document.getElementById("hud-toggle");
const mapToggle = document.getElementById("map-toggle");
hudToggle?.addEventListener("click", () => {
  const hud = document.getElementById("hud");
  if (!hud) return;
  const hidden = !hud.classList.contains("hud-details-hidden");
  hud.classList.toggle("hud-details-hidden", hidden);
  hudToggle.textContent = hidden ? "SHOW HUD" : "HIDE HUD";
  hudToggle.setAttribute("aria-pressed", String(hidden));
});
mapToggle?.addEventListener("click", () => {
  if (!mapPanel) return;
  const hidden = !mapPanel.classList.contains("hidden");
  mapPanel.classList.toggle("hidden", hidden);
  mapToggle.textContent = hidden ? "SHOW MAP" : "HIDE MAP";
  mapToggle.setAttribute("aria-expanded", String(!hidden));
});

setInterval(drawMinimap, 120);

try {
  init();
} catch (error) {
  console.error('Game startup failed:', error);
  loadingMessage.textContent = 'Startup error: ' + (error?.message || String(error));
  statusText.textContent = 'STARTUP ERROR';
}
