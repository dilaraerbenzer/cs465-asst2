//
//  moth.js : hierarchical model of the goth moth.
//
//  Structure, names and the traverse() function follow figure.js from
//  Angel & Shreiner, Chapter 9 (https://github.com/esangel/WebGL/blob/master/Chap9/figure.js):
//    - each part is a node made by createNode(transform, render, sibling, child)
//    - figure[] holds the nodes, initNodes(Id) rebuilds a node's transform
//      from its joint angles theta[Id]
//    - traverse(Id) walks the tree (left-child / right-sibling) with a
//      matrix stack, exactly as in the book.
//
//  Our modifications to the figure.js scheme:
//    - The parts, their parent/child structure and joint positions are not
//      hard-coded: they come from models/moth.rig.json, and the geometry of
//      each part comes from models/moth.obj (exported from Blender).
//    - theta[Id] is a vec3 (rotation about x, y and z) instead of one angle,
//      and every node also has a translation (used for the root's position).
//    - In figure.js, the render functions draw a unit cube scaled by an
//      instanceMatrix. Here every part has its own mesh, already placed so
//      that its joint (pivot) is at its local origin, so the instance matrix
//      is just the current modelViewMatrix.
//
//  Node transform (same idea as figure.js: move to the joint, then rotate):
//      M[Id] = translate(pivot[Id] - pivot[parent] + position[Id])
//              * rotateZ(theta[Id][2]) * rotateY(theta[Id][1]) * rotateX(theta[Id][0])
//

"use strict";

var figure = [];          // nodes, indexed by Id
var numNodes = 0;
var rootId = 0;           // the thorax

var partName = [];        // Id -> name
var partId = {};          // name -> Id
var parentId = [];        // Id -> parent Id (null for the root)
var pivot = [];           // Id -> joint position in model space (vec3)
var offset = [];          // Id -> pivot relative to the parent's pivot
var partColor = [];       // Id -> vec4 material colour

var theta = [];           // Id -> vec3, joint angles in degrees   (sliders / keyframes)
var position = [];        // Id -> vec3, extra translation          (global position of root)

var stack = [];
var modelViewMatrix;

var partBuffers = [];     // Id -> { vBuffer, nBuffer, tBuffer, numVertices }


function createNode( transform, render, sibling, child ) {
    var node = {
    transform: transform,
    render: render,
    sibling: sibling,
    child: child,
    }
    return node;
}


function initNodes( Id ) {

    var m = translate( offset[Id][0] + position[Id][0],
                       offset[Id][1] + position[Id][1],
                       offset[Id][2] + position[Id][2] );
    m = mult( m, rotateZ( theta[Id][2] ) );
    m = mult( m, rotateY( theta[Id][1] ) );
    m = mult( m, rotateX( theta[Id][0] ) );
    figure[Id].transform = m;
}


function traverse( Id ) {

   if(Id == null) return;
   stack.push(modelViewMatrix);
   modelViewMatrix = mult(modelViewMatrix, figure[Id].transform);
   figure[Id].render();
   if(figure[Id].child != null) traverse(figure[Id].child);
    modelViewMatrix = stack.pop();
   if(figure[Id].sibling != null) traverse(figure[Id].sibling);
}


//
//  Build the tree from the rig file and the parsed OBJ.
//  drawPart(Id) is the render function shared by all nodes (it is in main.js
//  because it needs the shader locations).
//
function buildMoth( gl, rig, objParts, drawPart ) {

    numNodes = rig.parts.length;

    for ( var Id = 0; Id < numNodes; ++Id ) {
        var p = rig.parts[Id];
        partName[Id] = p.name;
        partId[p.name] = Id;
        pivot[Id] = vec3( p.pivot[0], p.pivot[1], p.pivot[2] );
        var c = p.color || [ 0.5, 0.5, 0.5 ];
        partColor[Id] = vec4( c[0], c[1], c[2], 1.0 );
        theta[Id] = vec3( 0, 0, 0 );
        position[Id] = vec3( 0, 0, 0 );
    }

    // Parent links -> left-child / right-sibling links used by traverse().
    var lastChild = [];
    rootId = null;
    for ( var Id = 0; Id < numNodes; ++Id ) {
        var parentName = rig.parts[Id].parent;
        figure[Id] = createNode( mat4(), drawPart.bind( null, Id ), null, null );
        if ( parentName == null ) {
            if ( rootId != null ) throw "two root parts: " + partName[rootId] + ", " + partName[Id];
            rootId = Id;
            parentId[Id] = null;
            offset[Id] = pivot[Id];
            continue;
        }
        var P = partId[parentName];
        if ( P === undefined ) throw "part " + partName[Id] + " has unknown parent " + parentName;
        parentId[Id] = P;
        offset[Id] = vec3( pivot[Id][0] - pivot[P][0], pivot[Id][1] - pivot[P][1], pivot[Id][2] - pivot[P][2] );
        if ( lastChild[P] === undefined ) figure[P].child = Id;
        else figure[lastChild[P]].sibling = Id;
        lastChild[P] = Id;
    }
    if ( rootId == null ) throw "rig has no root part";

    // Geometry: shift every part so its pivot is at the origin, then upload.
    // Older Blender exporters name objects "<object>_<mesh>", so a
    // "<partName>_" prefix also matches.
    for ( var Id = 0; Id < numNodes; ++Id ) {
        var mesh = objParts[partName[Id]];
        if ( !mesh ) {
            for ( var name in objParts ) {
                if ( name.indexOf( partName[Id] + "_" ) == 0 && partId[name] === undefined ) { mesh = objParts[name]; break; }
            }
        }
        if ( !mesh ) { console.warn( "no geometry for part " + partName[Id] ); partBuffers[Id] = null; continue; }

        var pointsArray = [];
        for ( var i = 0; i < mesh.pointsArray.length; ++i ) {
            var v = mesh.pointsArray[i];
            pointsArray.push( vec4( v[0] - pivot[Id][0], v[1] - pivot[Id][1], v[2] - pivot[Id][2], 1.0 ) );
        }

        var vBuffer = gl.createBuffer();
        gl.bindBuffer( gl.ARRAY_BUFFER, vBuffer );
        gl.bufferData( gl.ARRAY_BUFFER, flatten( pointsArray ), gl.STATIC_DRAW );

        var nBuffer = gl.createBuffer();
        gl.bindBuffer( gl.ARRAY_BUFFER, nBuffer );
        gl.bufferData( gl.ARRAY_BUFFER, flatten( mesh.normalsArray ), gl.STATIC_DRAW );

        var tBuffer = gl.createBuffer();
        gl.bindBuffer( gl.ARRAY_BUFFER, tBuffer );
        gl.bufferData( gl.ARRAY_BUFFER, flatten( mesh.texCoordsArray ), gl.STATIC_DRAW );

        partBuffers[Id] = { vBuffer: vBuffer, nBuffer: nBuffer, tBuffer: tBuffer,
                            numVertices: pointsArray.length };
    }

    for ( var Id = 0; Id < numNodes; ++Id ) initNodes( Id );
}


//
//  Pose = every joint's parameters, keyed by part name.
//  This is what a keyframe stores and what save/load writes.
//
function getPose() {
    var pose = {};
    for ( var Id = 0; Id < numNodes; ++Id )
        pose[partName[Id]] = { theta:    [ theta[Id][0], theta[Id][1], theta[Id][2] ],
                               position: [ position[Id][0], position[Id][1], position[Id][2] ] };
    return pose;
}

function setPose( pose ) {
    for ( var name in pose ) {
        var Id = partId[name];
        if ( Id === undefined ) continue;
        if ( pose[name].theta ) theta[Id] = vec3( pose[name].theta[0], pose[name].theta[1], pose[name].theta[2] );
        if ( pose[name].position ) position[Id] = vec3( pose[name].position[0], pose[name].position[1], pose[name].position[2] );
        initNodes( Id );
    }
}

function resetPose() {
    for ( var Id = 0; Id < numNodes; ++Id ) {
        theta[Id] = vec3( 0, 0, 0 );
        position[Id] = vec3( 0, 0, 0 );
        initNodes( Id );
    }
}
