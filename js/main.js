//
//  main.js : WebGL setup, rendering, picking, mouse and UI.
//
//  The init()/render() structure, the lighting setup (light and material
//  products), configureTexture() and the spherical camera (radius, theta,
//  phi + lookAt) follow Angel & Shreiner: Chapter 6 shadedSphere4.js,
//  Chapter 7 textureCube1.js and Chapter 9 figure.js.
//
//  Ported from Furkan's furkan.html, adapted to this structure:
//    - the four render modes (colour / unlit texture / smooth shading /
//      shaded texture) and the selected-part highlight
//    - picking by drawing every part in its own id colour and reading the
//      pixel under the mouse (gl.readPixels)
//    - direct manipulation: drag a selected part to rotate its joint
//    - camera: orbit (drag empty space), pan (right/middle or Shift+drag),
//      zoom (wheel)
//    - joint sliders for the selected part, global position/orientation
//      sliders, keyframe list and animation controls (see animation.js)
//

"use strict";

var canvas;
var gl;
var program;

var projectionMatrix;
var modelViewMatrixLoc, projectionMatrixLoc, normalMatrixLoc;
var renderModeLoc, materialColorLoc, pickColorLoc, selectedLoc;
var vPosition, vNormal, vTexCoord;

// Light and material, as in shadedSphere4.js (material is white: the part's
// colour or texture is multiplied in by the fragment shader)
var lightPosition = vec4( 1.0, 2.0, 1.5, 0.0 );
var lightAmbient  = vec4( 0.25, 0.22, 0.28, 1.0 );
var lightDiffuse  = vec4( 1.0, 1.0, 1.0, 1.0 );
var lightSpecular = vec4( 1.0, 1.0, 1.0, 1.0 );

var materialAmbient   = vec4( 1.0, 1.0, 1.0, 1.0 );
var materialDiffuse   = vec4( 1.0, 1.0, 1.0, 1.0 );
var materialSpecular  = vec4( 0.4, 0.4, 0.4, 1.0 );
var materialShininess = 32.0;

// Camera: spherical coordinates around "at" (shadedSphere4.js uses radius, theta, phi)
var radius = 4.0;
var camTheta = 35.0;     // degrees around the y axis
var camPhi = 10.0;       // degrees above the ground
var at = [ 0.0, 0.0, -0.2 ];
var up = [ 0.0, 1.0, 0.0 ];

// Skybox (second shader program)
var skyProgram, skyBuffer, skyPositionLoc, skyViewMatrixLoc, skyProjectionLoc;
var cubeMap = null;
var skyFaces = [ "px", "nx", "py", "ny", "pz", "nz" ];

var renderMode = 3;
var selectedId = 0;
var showSelection = false;   // no highlight until the user selects a part
var pickingPass = false;
var lastTime = 0;


window.onload = function init() {

    canvas = document.getElementById( "gl-canvas" );

    // Works with the 7th edition Common (WebGLUtils) and the 8th edition (no webgl-utils.js).
    gl = ( typeof WebGLUtils !== "undefined" ) ? WebGLUtils.setupWebGL( canvas ) : canvas.getContext( "webgl" );
    if ( !gl ) { alert( "WebGL isn't available" ); }

    gl.clearColor( 0.44, 0.49, 0.40, 1.0 );
    gl.enable( gl.DEPTH_TEST );

    //
    //  Load shaders and get uniform / attribute locations
    //
    program = initShaders( gl, "vertex-shader", "fragment-shader" );
    gl.useProgram( program );

    vPosition = gl.getAttribLocation( program, "vPosition" );
    vNormal   = gl.getAttribLocation( program, "vNormal" );
    vTexCoord = gl.getAttribLocation( program, "vTexCoord" );

    modelViewMatrixLoc  = gl.getUniformLocation( program, "modelViewMatrix" );
    projectionMatrixLoc = gl.getUniformLocation( program, "projectionMatrix" );
    normalMatrixLoc     = gl.getUniformLocation( program, "normalMatrix" );
    renderModeLoc       = gl.getUniformLocation( program, "renderMode" );
    materialColorLoc    = gl.getUniformLocation( program, "materialColor" );
    pickColorLoc        = gl.getUniformLocation( program, "pickColor" );
    selectedLoc         = gl.getUniformLocation( program, "selected" );

    gl.uniform4fv( gl.getUniformLocation( program, "ambientProduct" ), flatten( mult( lightAmbient, materialAmbient ) ) );
    gl.uniform4fv( gl.getUniformLocation( program, "diffuseProduct" ), flatten( mult( lightDiffuse, materialDiffuse ) ) );
    gl.uniform4fv( gl.getUniformLocation( program, "specularProduct" ), flatten( mult( lightSpecular, materialSpecular ) ) );
    gl.uniform4fv( gl.getUniformLocation( program, "lightPosition" ), flatten( lightPosition ) );
    gl.uniform1f( gl.getUniformLocation( program, "shininess" ), materialShininess );
    gl.uniform1i( gl.getUniformLocation( program, "texture" ), 0 );

    setupSkybox();
    setupMouse();

    //
    //  Load the model (fetch needs the page to be served over http)
    //
    Promise.all( [
        fetch( "models/moth.obj" ).then( function ( r ) { return r.text(); } ),
        fetch( "models/moth.rig.json" ).then( function ( r ) { return r.json(); } )
    ] ).then( function ( files ) {
        buildMoth( gl, files[1], loadOBJ( files[0] ), drawPart );
        loadTextures();
        selectedId = rootId;
        setupUI();
        requestAnimationFrame( render );
    } ).catch( function ( e ) {
        document.getElementById( "status" ).textContent =
            "Could not load the model (" + e + "). Serve the folder over http, e.g. python3 -m http.server";
        throw e;
    } );
};


//
//  Render function of every node (figure[Id].render calls this).
//  Like the render functions in figure.js, but each part has its own mesh,
//  so the instance matrix is the current modelViewMatrix.
//
function drawPart( Id ) {

    var b = partBuffers[Id];
    if ( !b ) return;

    var instanceMatrix = modelViewMatrix;
    gl.uniformMatrix4fv( modelViewMatrixLoc, false, flatten( instanceMatrix ) );

    // Normal matrix = upper-left 3x3 of the model-view matrix, as in
    // shadedSphere4.js. This is valid because the model only uses rotations
    // and translations (no scaling). Built with mat3() so flatten() transposes
    // it to column-major like the other matrices (the book's version uses a
    // plain array, which uploads the transpose).
    var m = instanceMatrix;
    var nMatrix = mat3( m[0][0], m[0][1], m[0][2],
                        m[1][0], m[1][1], m[1][2],
                        m[2][0], m[2][1], m[2][2] );
    gl.uniformMatrix3fv( normalMatrixLoc, false, flatten( nMatrix ) );

    if ( pickingPass ) {
        // id colour: red channel = Id + 1 (0 = background)
        gl.uniform1i( renderModeLoc, 4 );
        gl.uniform4fv( pickColorLoc, flatten( vec4( ( Id + 1 ) / 255.0, 0.0, 0.0, 1.0 ) ) );
    } else {
        // texture modes fall back to the colour version until the image has loaded
        var mode = renderMode;
        var texturedMode = ( mode == 1 || mode == 3 );
        if ( texturedMode && !partTexture[Id] ) mode = ( mode == 1 ) ? 0 : 2;
        gl.uniform1i( renderModeLoc, mode );
        gl.uniform4fv( materialColorLoc, flatten( partColor[Id] ) );
        gl.uniform1f( selectedLoc, ( showSelection && Id == selectedId ) ? 1.0 : 0.0 );
        if ( mode == 1 || mode == 3 ) {
            gl.activeTexture( gl.TEXTURE0 );
            gl.bindTexture( gl.TEXTURE_2D, partTexture[Id] );
        }
    }

    gl.bindBuffer( gl.ARRAY_BUFFER, b.vBuffer );
    gl.vertexAttribPointer( vPosition, 4, gl.FLOAT, false, 0, 0 );
    gl.enableVertexAttribArray( vPosition );

    gl.bindBuffer( gl.ARRAY_BUFFER, b.nBuffer );
    gl.vertexAttribPointer( vNormal, 4, gl.FLOAT, false, 0, 0 );
    gl.enableVertexAttribArray( vNormal );

    if ( vTexCoord >= 0 ) {
        gl.bindBuffer( gl.ARRAY_BUFFER, b.tBuffer );
        gl.vertexAttribPointer( vTexCoord, 2, gl.FLOAT, false, 0, 0 );
        gl.enableVertexAttribArray( vTexCoord );
    }

    gl.drawArrays( gl.TRIANGLES, 0, b.numVertices );
}


//
//  Textures: configureTexture() is from Angel & Shreiner Chapter 7,
//  textureCube1.js. Modified to return the texture (one per part) instead of
//  using a single global, and to use LINEAR filtering for smoother results.
//  The images must be power-of-two sized (WebGL 1 mipmaps).
//
function configureTexture( image ) {
    var texture = gl.createTexture();
    gl.bindTexture( gl.TEXTURE_2D, texture );
    gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, true );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGB,
         gl.RGB, gl.UNSIGNED_BYTE, image );
    gl.generateMipmap( gl.TEXTURE_2D );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
                      gl.LINEAR_MIPMAP_LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
    return texture;
}

function loadTextures() {
    for ( var Id = 0; Id < numNodes; ++Id ) {
        if ( !partTextureFile[Id] ) continue;
        var image = new Image();
        image.onload = ( function ( Id, image ) {
            return function () { partTexture[Id] = configureTexture( image ); };
        } )( Id, image );
        image.src = "models/" + partTextureFile[Id];
    }
}


//
//  Skybox: a cube of side 2 around the camera, textured with a cube-map.
//  configureCubeMap() is from Angel & Shreiner Chapter 7, reflectionMap.js;
//  modified to upload six images (models/skybox/*.jpg) instead of six 1x1
//  colours, and to use LINEAR filtering. The images are not flipped: cube-map
//  faces use the image's top row as t = 0.
//
function configureCubeMap( images ) {

    cubeMap = gl.createTexture();

    gl.bindTexture( gl.TEXTURE_CUBE_MAP, cubeMap );
    gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false );
    var targets = [ gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                    gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
                    gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z ];
    for ( var i = 0; i < 6; ++i )
        gl.texImage2D( targets[i], 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, images[i] );

    gl.texParameteri( gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
    gl.texParameteri( gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );
}

function setupSkybox() {

    skyProgram = initShaders( gl, "sky-vertex-shader", "sky-fragment-shader" );
    skyPositionLoc   = gl.getAttribLocation( skyProgram, "vPosition" );
    skyViewMatrixLoc = gl.getUniformLocation( skyProgram, "skyViewMatrix" );
    skyProjectionLoc = gl.getUniformLocation( skyProgram, "projectionMatrix" );

    // cube from the 8 corners, two triangles per face (like quad() in the book)
    var v = [ vec4( -1, -1,  1, 1 ), vec4( -1,  1,  1, 1 ), vec4(  1,  1,  1, 1 ), vec4(  1, -1,  1, 1 ),
              vec4( -1, -1, -1, 1 ), vec4( -1,  1, -1, 1 ), vec4(  1,  1, -1, 1 ), vec4(  1, -1, -1, 1 ) ];
    var pointsArray = [];
    function quad( a, b, c, d ) { [ a, b, c, a, c, d ].forEach( function ( i ) { pointsArray.push( v[i] ); } ); }
    quad( 1, 0, 3, 2 ); quad( 2, 3, 7, 6 ); quad( 3, 0, 4, 7 );
    quad( 6, 5, 1, 2 ); quad( 4, 5, 6, 7 ); quad( 5, 4, 0, 1 );

    skyBuffer = gl.createBuffer();
    gl.bindBuffer( gl.ARRAY_BUFFER, skyBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, flatten( pointsArray ), gl.STATIC_DRAW );

    // load the six faces, then build the cube-map
    var images = [], loaded = 0;
    skyFaces.forEach( function ( face, i ) {
        images[i] = new Image();
        images[i].onload = function () { if ( ++loaded == 6 ) configureCubeMap( images ); };
        images[i].src = "models/skybox/" + face + ".jpg";
    } );
}

function drawSky( eye ) {

    gl.useProgram( skyProgram );
    gl.uniformMatrix4fv( skyProjectionLoc, false, flatten( projectionMatrix ) );
    // camera rotation only: look in the same direction from the origin
    var dir = vec3( at[0] - eye[0], at[1] - eye[1], at[2] - eye[2] );
    gl.uniformMatrix4fv( skyViewMatrixLoc, false, flatten( lookAt( vec3( 0, 0, 0 ), dir, vec3( up[0], up[1], up[2] ) ) ) );

    // only vPosition is used here; turn off the moth's other attribute arrays
    if ( vNormal >= 0 ) gl.disableVertexAttribArray( vNormal );
    if ( vTexCoord >= 0 ) gl.disableVertexAttribArray( vTexCoord );
    gl.bindBuffer( gl.ARRAY_BUFFER, skyBuffer );
    gl.vertexAttribPointer( skyPositionLoc, 4, gl.FLOAT, false, 0, 0 );
    gl.enableVertexAttribArray( skyPositionLoc );

    gl.activeTexture( gl.TEXTURE0 );
    gl.bindTexture( gl.TEXTURE_CUBE_MAP, cubeMap );
    // Drawn first with no depth test and no depth writes: it is always behind
    // (its depth would be exactly 1.0, which the default LESS test rejects).
    gl.disable( gl.DEPTH_TEST );
    gl.depthMask( false );
    gl.drawArrays( gl.TRIANGLES, 0, 36 );
    gl.depthMask( true );
    gl.enable( gl.DEPTH_TEST );

    gl.useProgram( program );
}


//
//  Draw the scene (normal pass, or the picking pass with id colours).
//
function drawScene( picking ) {

    // Keep the canvas resolution equal to its size on screen.
    var dpr = window.devicePixelRatio || 1;
    var w = Math.round( canvas.clientWidth * dpr ), h = Math.round( canvas.clientHeight * dpr );
    if ( canvas.width != w || canvas.height != h ) { canvas.width = w; canvas.height = h; }
    gl.viewport( 0, 0, canvas.width, canvas.height );

    projectionMatrix = perspective( 45.0, canvas.width / canvas.height, 0.05, 100.0 );
    gl.useProgram( program );
    gl.uniformMatrix4fv( projectionMatrixLoc, false, flatten( projectionMatrix ) );

    if ( picking ) gl.clearColor( 0.0, 0.0, 0.0, 1.0 );
    else gl.clearColor( 0.44, 0.49, 0.40, 1.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

    var eye = vec3(
        at[0] + radius * Math.cos( radians( camPhi ) ) * Math.sin( radians( camTheta ) ),
        at[1] + radius * Math.sin( radians( camPhi ) ),
        at[2] + radius * Math.cos( radians( camPhi ) ) * Math.cos( radians( camTheta ) ) );

    if ( !picking && cubeMap && document.getElementById( "skyboxOn" ).checked ) drawSky( eye );

    modelViewMatrix = lookAt( eye, vec3( at[0], at[1], at[2] ), vec3( up[0], up[1], up[2] ) );
    pickingPass = picking;
    traverse( rootId );
    pickingPass = false;
}

var render = function( now ) {

    var dt = Math.min( ( now - lastTime ) / 1000.0, 0.1 );
    lastTime = now;
    if ( stepAnimation( dt, +document.getElementById( "frameTime" ).value,
                        document.getElementById( "loop" ).checked ) ) {
        syncUI();
        if ( !playing ) document.getElementById( "playButton" ).textContent = "Play";
    }

    drawScene( false );
    requestAnimationFrame( render );
};

// Returns the Id of the part under canvas pixel (x, y), or -1.
function pickPart( x, y ) {
    drawScene( true );
    var pixel = new Uint8Array( 4 );
    var px = Math.floor( x * canvas.width / canvas.clientWidth );
    var py = Math.floor( canvas.height - 1 - y * canvas.height / canvas.clientHeight );
    gl.readPixels( px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel );
    var Id = pixel[0] - 1;
    return ( Id >= 0 && Id < numNodes ) ? Id : -1;
}


//
//  Mouse: click = select part; drag part = rotate its joint (Alt: z axis);
//  drag empty space = orbit; right/middle or Shift+drag = pan; wheel = zoom.
//
function setupMouse() {

    var drag = null, lastX = 0, lastY = 0;

    canvas.addEventListener( "contextmenu", function ( e ) { e.preventDefault(); } );
    canvas.addEventListener( "mousedown", function ( e ) {
        if ( !numNodes ) return;
        if ( e.button != 0 || e.shiftKey ) { drag = "pan"; }
        else {
            var r = canvas.getBoundingClientRect();
            var Id = pickPart( e.clientX - r.left, e.clientY - r.top );
            if ( Id >= 0 ) { selectPart( Id ); drag = "part"; }
            else drag = "orbit";
        }
        lastX = e.clientX; lastY = e.clientY;
        canvas.style.cursor = "grabbing";
    } );
    window.addEventListener( "mouseup", function () { drag = null; canvas.style.cursor = "grab"; } );
    window.addEventListener( "mousemove", function ( e ) {
        if ( !drag ) return;
        var dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        if ( drag == "part" ) {
            var t = theta[selectedId];
            if ( e.altKey ) t[2] = wrapAngle( t[2] + dx * 0.5 );
            else { t[1] = wrapAngle( t[1] + dx * 0.5 ); t[0] = wrapAngle( t[0] + dy * 0.5 ); }
            initNodes( selectedId );
            syncUI();
        } else if ( drag == "orbit" ) {
            camTheta -= dx * 0.4;
            camPhi = Math.max( -89, Math.min( 89, camPhi + dy * 0.4 ) );
        } else {
            var s = radius * 0.0016;
            at[0] -= Math.cos( radians( camTheta ) ) * dx * s;
            at[2] += Math.sin( radians( camTheta ) ) * dx * s;
            at[1] += dy * s;
        }
    } );
    canvas.addEventListener( "wheel", function ( e ) {
        e.preventDefault();
        radius = Math.max( 0.5, Math.min( 30, radius * Math.exp( e.deltaY * 0.001 ) ) );
    }, { passive: false } );
}

function wrapAngle( a ) { return ( ( a + 180 ) % 360 + 360 ) % 360 - 180; }


//
//  UI panel
//
var jointSliders = [ "jointX", "jointY", "jointZ" ];
var globalPosSliders = [ "globalPX", "globalPY", "globalPZ" ];
var globalRotSliders = [ "globalRX", "globalRY", "globalRZ" ];

function $( id ) { return document.getElementById( id ); }

function setSlider( id, value ) {
    $( id ).value = value;
    $( id ).nextElementSibling.textContent = ( +value ).toFixed( $( id ).step < 1 ? 2 : 0 );
}

function syncUI() {
    $( "selName" ).textContent = partName[selectedId];
    $( "partSelect" ).value = selectedId;
    var lim = jointLimitsOn ? jointLimits[selectedId] : null;
    for ( var k = 0; k < 3; ++k ) {
        // the joint sliders only cover the selected part's allowed range
        $( jointSliders[k] ).min = lim ? lim[k][0] : -180;
        $( jointSliders[k] ).max = lim ? lim[k][1] : 180;
        setSlider( jointSliders[k], theta[selectedId][k] );
        setSlider( globalPosSliders[k], position[rootId][k] );
        setSlider( globalRotSliders[k], theta[rootId][k] );
    }
}

function selectPart( Id ) { selectedId = Id; showSelection = true; syncUI(); }

function renderFrameList() {
    var html = "";
    for ( var i = 0; i < frames.length; ++i )
        html += '<li data-i="' + i + '" class="' + ( i == currentFrame ? "on" : "" ) + '">' + ( i + 1 ) + "</li>";
    $( "frameList" ).innerHTML = html || '<span class="hint">No keyframes yet</span>';
}

function stopPlaying() { playing = false; $( "playButton" ).textContent = "Play"; }

function usePreset( list, frameTime ) {
    stopPlaying();
    frames = list;
    currentFrame = 0;
    setSlider( "frameTime", frameTime );
    setPose( frames[0] );
    renderFrameList();
    syncUI();
    playing = true; animTime = 0;
    $( "playButton" ).textContent = "Stop";
}

function setupUI() {

    $( "renderMode" ).onchange = function ( e ) { renderMode = +e.target.value; };

    // Part list drawn as the hierarchy tree: walk figure[] with the same
    // child / sibling links that traverse() uses, so every part is listed
    // under its parent (e.g. head > antennae, leg > lower leg > foot).
    var select = $( "partSelect" );
    function addTreeRows( Id, prefix, isLast, isRoot ) {
        if ( Id == null ) return;
        var option = document.createElement( "option" );
        option.value = Id;
        option.textContent = isRoot ? partName[Id]
                                    : prefix + ( isLast ? "\u2514\u2500 " : "\u251c\u2500 " ) + partName[Id];
        select.appendChild( option );
        var childPrefix = isRoot ? "" : prefix + ( isLast ? "\u00a0\u00a0\u00a0" : "\u2502\u00a0\u00a0" );
        for ( var c = figure[Id].child; c != null; c = figure[c].sibling )
            addTreeRows( c, childPrefix, figure[c].sibling == null, false );
    }
    addTreeRows( rootId, "", true, true );
    select.onchange = function ( e ) { selectPart( +e.target.value ); };

    // Like the sliders of figure.html: change theta / position, then initNodes.
    jointSliders.forEach( function ( id, k ) {
        $( id ).oninput = function ( e ) {
            theta[selectedId][k] = +e.target.value; initNodes( selectedId ); syncUI();
        };
    } );
    globalPosSliders.forEach( function ( id, k ) {
        $( id ).oninput = function ( e ) {
            position[rootId][k] = +e.target.value; initNodes( rootId ); syncUI();
        };
    } );
    globalRotSliders.forEach( function ( id, k ) {
        $( id ).oninput = function ( e ) {
            theta[rootId][k] = +e.target.value; initNodes( rootId ); syncUI();
        };
    } );
    $( "resetButton" ).onclick = function () { stopPlaying(); resetPose(); syncUI(); };
    $( "limitsOn" ).onchange = function ( e ) { setJointLimitsOn( e.target.checked ); syncUI(); };

    // Keyframes
    $( "frameList" ).onclick = function ( e ) {
        var i = e.target.dataset.i;
        if ( i === undefined ) return;
        stopPlaying();
        currentFrame = +i; setPose( frames[currentFrame] ); renderFrameList(); syncUI();
    };
    $( "addFrame" ).onclick = function () {
        frames.splice( currentFrame + 1, 0, getPose() ); currentFrame++; renderFrameList();
    };
    $( "updateFrame" ).onclick = function () { if ( currentFrame >= 0 ) frames[currentFrame] = getPose(); };
    $( "deleteFrame" ).onclick = function () {
        if ( currentFrame < 0 ) return;
        frames.splice( currentFrame, 1 );
        currentFrame = Math.min( currentFrame, frames.length - 1 );
        renderFrameList();
    };
    $( "clearFrames" ).onclick = function () { stopPlaying(); frames = []; currentFrame = -1; renderFrameList(); };
    $( "frameTime" ).oninput = function ( e ) { setSlider( "frameTime", e.target.value ); };
    setSlider( "frameTime", $( "frameTime" ).value );
    $( "playButton" ).onclick = function () {
        if ( frames.length < 2 ) { alert( "Add at least two keyframes first." ); return; }
        playing = !playing; animTime = 0;
        $( "playButton" ).textContent = playing ? "Stop" : "Play";
    };
    $( "presetWalk" ).onclick = function () { usePreset( presetWalk(), 0.08 ); };
    $( "presetFly" ).onclick = function () { usePreset( presetFly(), 0.05 ); };
    $( "presetTwerk" ).onclick = function () { usePreset( presetTwerk(), 0.07 ); };

    // Save / load
    $( "saveButton" ).onclick = function () {
        if ( !frames.length ) { alert( "No keyframes to save." ); return; }
        saveAnimation( +$( "frameTime" ).value );
    };
    $( "loadFile" ).onchange = function ( e ) {
        var file = e.target.files[0];
        if ( !file ) return;
        var reader = new FileReader();
        reader.onload = function () {
            try {
                stopPlaying();
                var frameTime = loadAnimation( reader.result );
                if ( frameTime ) setSlider( "frameTime", frameTime );
                renderFrameList(); syncUI();
            } catch ( err ) { alert( "Could not read the file: " + err ); }
        };
        reader.readAsText( file );
        e.target.value = "";
    };

    $( "status" ).textContent = numNodes + " parts loaded, root = " + partName[rootId];
    renderFrameList();
    syncUI();
}
