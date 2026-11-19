//
//  main.js : WebGL setup, lighting, camera and render loop.
//
//  The init()/render() structure, the lighting setup (light and material
//  products) and the spherical camera (radius, theta, phi + lookAt) follow
//  Angel & Shreiner Chapter 6, shadedSphere4.js, and Chapter 9, figure.js.
//  Our modifications:
//    - the model is loaded from models/moth.obj + models/moth.rig.json
//    - material colour is per part (diffuseProduct set in drawPart)
//    - the camera's angles and radius are changed with the mouse instead of
//      buttons, and there is a pan offset (at)
//    - a "rig check" panel (part list + x/y/z sliders) to test the joints;
//      the full UI and animation (parts 3-4 of the assignment) go on top
//

"use strict";

var canvas;
var gl;
var program;

var projectionMatrix;
var modelViewMatrixLoc, projectionMatrixLoc, normalMatrixLoc;
var ambientProductLoc, diffuseProductLoc, specularProductLoc, useTextureLoc;
var vPosition, vNormal, vTexCoord;

// Light and material, as in shadedSphere4.js
var lightPosition = vec4( 1.0, 2.0, 1.5, 0.0 );
var lightAmbient  = vec4( 0.25, 0.22, 0.28, 1.0 );
var lightDiffuse  = vec4( 1.0, 1.0, 1.0, 1.0 );
var lightSpecular = vec4( 1.0, 1.0, 1.0, 1.0 );

var materialSpecular  = vec4( 0.4, 0.4, 0.4, 1.0 );
var materialShininess = 32.0;

// Camera: spherical coordinates around "at" (shadedSphere4.js uses radius, theta, phi)
var radius = 4.0;
var camTheta = 35.0;     // degrees around the y axis
var camPhi = 25.0;       // degrees above the ground
var at = [ 0.0, 0.0, -0.2 ];
var up = [ 0.0, 1.0, 0.0 ];

var selectedId = 0;
var startTime;


window.onload = function init() {

    canvas = document.getElementById( "gl-canvas" );

    // Works with the 7th edition Common (WebGLUtils) and the 8th edition (no webgl-utils.js).
    gl = ( typeof WebGLUtils !== "undefined" ) ? WebGLUtils.setupWebGL( canvas ) : canvas.getContext( "webgl" );
    if ( !gl ) { alert( "WebGL isn't available" ); }

    gl.viewport( 0, 0, canvas.width, canvas.height );
    gl.clearColor( 0.11, 0.1, 0.13, 1.0 );
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
    ambientProductLoc   = gl.getUniformLocation( program, "ambientProduct" );
    diffuseProductLoc   = gl.getUniformLocation( program, "diffuseProduct" );
    specularProductLoc  = gl.getUniformLocation( program, "specularProduct" );
    useTextureLoc       = gl.getUniformLocation( program, "useTexture" );
    gl.uniform1i( gl.getUniformLocation( program, "texture" ), 0 );

    gl.uniform4fv( specularProductLoc, flatten( mult( lightSpecular, materialSpecular ) ) );
    gl.uniform4fv( gl.getUniformLocation( program, "lightPosition" ), flatten( lightPosition ) );
    gl.uniform1f( gl.getUniformLocation( program, "shininess" ), materialShininess );

    projectionMatrix = perspective( 45.0, canvas.width / canvas.height, 0.05, 100.0 );
    gl.uniformMatrix4fv( projectionMatrixLoc, false, flatten( projectionMatrix ) );

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
        setupRigPanel();
        startTime = Date.now();
        render();
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

    // With a texture the material is white and the texture gives the colour.
    var textured = partTexture[Id] && document.getElementById( "textures" ).checked;
    var materialColor = textured ? vec4( 1.0, 1.0, 1.0, 1.0 ) : partColor[Id];
    gl.uniform4fv( ambientProductLoc, flatten( mult( lightAmbient, materialColor ) ) );
    gl.uniform4fv( diffuseProductLoc, flatten( mult( lightDiffuse, materialColor ) ) );
    gl.uniform1f( useTextureLoc, textured ? 1.0 : 0.0 );
    if ( textured ) {
        gl.activeTexture( gl.TEXTURE0 );
        gl.bindTexture( gl.TEXTURE_2D, partTexture[Id] );
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


var render = function() {

    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

    if ( document.getElementById( "wiggle" ).checked ) wiggle( ( Date.now() - startTime ) / 1000.0 );

    var eye = vec3(
        at[0] + radius * Math.cos( radians( camPhi ) ) * Math.sin( radians( camTheta ) ),
        at[1] + radius * Math.sin( radians( camPhi ) ),
        at[2] + radius * Math.cos( radians( camPhi ) ) * Math.cos( radians( camTheta ) ) );

    modelViewMatrix = lookAt( eye, vec3( at[0], at[1], at[2] ), vec3( up[0], up[1], up[2] ) );
    traverse( rootId );

    requestAnimationFrame( render );
};


//
//  Mouse camera: drag = rotate, shift+drag = pan, wheel = zoom.
//
function setupMouse() {

    var dragging = false, panning = false, lastX = 0, lastY = 0;

    canvas.addEventListener( "mousedown", function ( e ) {
        dragging = true; panning = e.shiftKey; lastX = e.clientX; lastY = e.clientY;
    } );
    window.addEventListener( "mouseup", function () { dragging = false; } );
    window.addEventListener( "mousemove", function ( e ) {
        if ( !dragging ) return;
        var dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        if ( panning ) {
            var s = radius * 0.002;
            at[0] -= Math.cos( radians( camTheta ) ) * dx * s;
            at[2] += Math.sin( radians( camTheta ) ) * dx * s;
            at[1] += dy * s;
        } else {
            camTheta -= dx * 0.4;
            camPhi = Math.max( -89, Math.min( 89, camPhi + dy * 0.4 ) );
        }
    } );
    canvas.addEventListener( "wheel", function ( e ) {
        e.preventDefault();
        radius = Math.max( 0.5, Math.min( 30, radius * Math.exp( e.deltaY * 0.001 ) ) );
    }, { passive: false } );
}


//
//  Rig check panel: pick a part, rotate it with the x/y/z sliders
//  (like the sliders of figure.html: change theta, then call initNodes).
//
function setupRigPanel() {

    var select = document.getElementById( "partSelect" );
    for ( var Id = 0; Id < numNodes; ++Id ) {
        var depth = 0;
        for ( var p = parentId[Id]; p != null; p = parentId[p] ) depth++;
        var option = document.createElement( "option" );
        option.value = Id;
        option.textContent = "  ".repeat( depth ) + partName[Id];
        select.appendChild( option );
    }
    select.value = rootId;
    selectedId = rootId;

    var sliders = [ "sliderX", "sliderY", "sliderZ" ];
    function refresh() {
        for ( var k = 0; k < 3; ++k ) document.getElementById( sliders[k] ).value = theta[selectedId][k];
    }

    select.onchange = function ( event ) {
        selectedId = +event.target.value;
        refresh();
    };

    sliders.forEach( function ( id, k ) {
        document.getElementById( id ).oninput = function ( event ) {
            document.getElementById( "wiggle" ).checked = false;
            theta[selectedId][k] = +event.target.value;
            initNodes( selectedId );
        };
    } );

    document.getElementById( "resetButton" ).onclick = function () {
        document.getElementById( "wiggle" ).checked = false;
        resetPose();
        refresh();
    };

    document.getElementById( "status" ).textContent =
        numNodes + " parts loaded, root = " + partName[rootId];
}


//
//  Test motion that moves every joint, to check all pivots at once.
//
function wiggle( t ) {

    for ( var Id = 0; Id < numNodes; ++Id ) {
        var name = partName[Id];
        var side = name.slice( -2 ) == "_R" ? -1 : 1;
        if ( name.indexOf( "wing" ) >= 0 )            theta[Id] = vec3( 0, 0, side * 30 * Math.sin( t * 6 ) );
        else if ( name.indexOf( "_upper" ) >= 0 )     theta[Id] = vec3( 15 * Math.sin( t * 3 + Id ), 0, 0 );
        else if ( name.indexOf( "_lower" ) >= 0 )     theta[Id] = vec3( 0, 0, side * 15 * Math.sin( t * 3 + Id ) );
        else if ( name.indexOf( "leg_" ) == 0 )       theta[Id] = vec3( 15 * Math.sin( t * 3 + Id ), 0, 0 );
        else if ( name.indexOf( "antenna" ) == 0 )    theta[Id] = vec3( 10 * Math.sin( t * 2 ), 0, 0 );
        else if ( name == "head" )                    theta[Id] = vec3( 0, 10 * Math.sin( t ), 0 );
        else if ( name == "abdomen" )                 theta[Id] = vec3( 8 * Math.sin( t * 1.5 ), 0, 0 );
        else continue;
        initNodes( Id );
    }
}
