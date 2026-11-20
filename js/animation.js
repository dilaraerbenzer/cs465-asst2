//
//  animation.js : keyframes, interpolation, preset animations, save/load.
//
//  Ported from Furkan's furkan.html (snap/apply/lerp/blend keyframe logic,
//  play loop, save/load as JSON, walk and fly presets). Changes:
//    - a keyframe is a pose from getPose() (moth.js): every part's theta and
//      position, keyed by part NAME, so saved files keep working if parts are
//      added or reordered
//    - the global position/orientation is the root (thorax) node's
//      position/theta instead of a separate array
//    - the presets were rewritten for the moth's joints (tripod gait at the
//      hips, knees and feet fold while a leg is lifted; flapping about the body axis
//      for the wings)
//

"use strict";

var frames = [];          // list of poses
var currentFrame = -1;    // selected keyframe in the list
var playing = false;
var animTime = 0;         // position in the animation, in frames


function lerp( a, b, t ) { return a + ( b - a ) * t; }

// Linear interpolation of two poses (every joint angle and position).
function blendPoses( A, B, t ) {
    var pose = {};
    for ( var name in A ) {
        if ( !B[name] ) { pose[name] = A[name]; continue; }
        pose[name] = {
            theta:    [ 0, 1, 2 ].map( function ( k ) { return lerp( A[name].theta[k],    B[name].theta[k],    t ); } ),
            position: [ 0, 1, 2 ].map( function ( k ) { return lerp( A[name].position[k], B[name].position[k], t ); } )
        };
    }
    return pose;
}

// Advance the animation by dt seconds. frameTime = seconds per keyframe.
function stepAnimation( dt, frameTime, loop ) {
    var n = frames.length;
    if ( !playing || n < 2 ) return false;
    var segments = loop ? n : n - 1;          // looping also blends last -> first
    animTime += dt / frameTime;
    if ( animTime >= segments ) {
        if ( loop ) animTime %= segments;
        else { playing = false; animTime = 0; setPose( frames[n - 1] ); return true; }
    }
    var i = Math.floor( animTime );
    setPose( blendPoses( frames[i], frames[( i + 1 ) % n], animTime - i ) );
    return true;
}


//
//  Presets
//
function restPose() {
    var pose = {};
    for ( var Id = 0; Id < numNodes; ++Id ) pose[partName[Id]] = { theta: [ 0, 0, 0 ], position: [ 0, 0, 0 ] };
    return pose;
}

function setJoint( pose, name, theta, position ) {
    if ( !pose[name] ) return;                // part not in this model
    if ( theta ) pose[name].theta = theta;
    if ( position ) pose[name].position = position;
}

function sideOf( name ) { return name.slice( -2 ) == "_R" ? -1 : 1; }

// Tripod gait: front-left, mid-right, hind-left move together, the other three
// in opposite phase. A leg swings forward (rotation about y) while lifted
// (rotation about z), then pushes back on the ground. 12 keyframes per cycle.
function presetWalk() {
    var N = 12, result = [];
    var groupA = { leg_front_L: 1, leg_mid_R: 1, leg_hind_L: 1 };
    for ( var i = 0; i < N; ++i ) {
        var pose = restPose(), ph = i / N * 2 * Math.PI;
        for ( var Id = 0; Id < numNodes; ++Id ) {
            var name = partName[Id];
            if ( name.indexOf( "leg_" ) != 0 ) continue;
            var s = sideOf( name );
            var hip = name.replace( "_lower", "" ).replace( "_foot", "" );   // follow the upper leg's phase
            var p = ph + ( groupA[hip] ? 0 : Math.PI );
            var forward = Math.sin( p );                  // +1 = foot forward
            var lift = Math.max( 0, Math.cos( p ) );      // lifted while moving forward
            if ( name.indexOf( "_foot" ) >= 0 )
                setJoint( pose, name, [ -20 * lift, 0, 0 ] );                 // foot curls while lifted
            else if ( name.indexOf( "_lower" ) >= 0 )
                setJoint( pose, name, [ -35 * lift + 8 * forward, 0, 0 ] );   // knee folds while lifted
            else
                setJoint( pose, name, [ 0, -s * 26 * forward, s * 22 * lift ] );
        }
        setJoint( pose, "thorax", [ 0, 0, 3 * Math.sin( 2 * ph ) ], [ 0, 0.02 * Math.abs( Math.sin( ph ) ), 0 ] );
        setJoint( pose, "head", [ 0, 6 * Math.sin( ph ), 0 ] );
        setJoint( pose, "abdomen", [ 4 * Math.sin( 2 * ph ), -4 * Math.sin( ph ), 0 ] );
        setJoint( pose, "abdomen_tip", [ 3 * Math.sin( 2 * ph + 1 ), -3 * Math.sin( ph + 1 ), 0 ] );
        setJoint( pose, "antenna_L", [ 8 * Math.sin( 2 * ph ), 0, 0 ] );
        setJoint( pose, "antenna_R", [ 8 * Math.sin( 2 * ph + 1 ), 0, 0 ] );
        result.push( pose );
    }
    return result;
}

// Flight: wings flap about the body axis, the body rises and bobs, pitches
// nose-up, legs fold back, abdomen sways. 8 keyframes per wing beat.
function presetFly() {
    var N = 8, result = [];
    for ( var i = 0; i < N; ++i ) {
        var pose = restPose(), ph = i / N * 2 * Math.PI;
        for ( var Id = 0; Id < numNodes; ++Id ) {
            var name = partName[Id], s = sideOf( name );
            if ( name.indexOf( "wing" ) >= 0 ) setJoint( pose, name, [ 0, 0, s * ( 15 + 45 * Math.sin( ph ) ) ] );
            else if ( name.indexOf( "_foot" ) >= 0 ) setJoint( pose, name, [ -30, 0, 0 ] );    // feet curled
            else if ( name.indexOf( "_lower" ) >= 0 ) setJoint( pose, name, [ -45, 0, 0 ] );   // knees folded
            else if ( name.indexOf( "leg_" ) == 0 ) setJoint( pose, name, [ 0, s * 25, s * 20 ] );
        }
        setJoint( pose, "thorax", [ -12, 0, 0 ], [ 0, 0.35 + 0.1 * Math.sin( ph ), 0 ] );
        setJoint( pose, "abdomen", [ 6 * Math.sin( ph + 1 ), 0, 0 ] );
        setJoint( pose, "abdomen_tip", [ 8 * Math.sin( ph + 2 ), 0, 0 ] );
        setJoint( pose, "antenna_L", [ -10, 0, 0 ] );
        setJoint( pose, "antenna_R", [ -10, 0, 0 ] );
        result.push( pose );
    }
    return result;
}


// Twerk: body tilted nose-down with the abdomen raised, squatting on bent
// legs, the abdomen bouncing twice per cycle with the tip whipping behind it,
// head glancing back, wings half-raised and fluttering. 8 keyframes per cycle.
function presetTwerk() {
    var N = 8, result = [];
    for ( var i = 0; i < N; ++i ) {
        var pose = restPose(), ph = i / N * 2 * Math.PI;
        var bounce = Math.sin( 2 * ph );                    // two bounces per cycle
        for ( var Id = 0; Id < numNodes; ++Id ) {
            var name = partName[Id], s = sideOf( name );
            if ( name.indexOf( "wing" ) >= 0 ) setJoint( pose, name, [ 0, 0, s * ( 20 + 8 * Math.sin( 4 * ph ) ) ] );
            else if ( name.indexOf( "_foot" ) >= 0 ) setJoint( pose, name, [ -15, 0, 0 ] );
            else if ( name.indexOf( "_lower" ) >= 0 ) setJoint( pose, name, [ -30 - 6 * bounce, 0, 0 ] );  // squat
            else if ( name.indexOf( "leg_hind" ) == 0 ) setJoint( pose, name, [ 0, s * 10, s * 12 ] );     // hind legs spread
            else if ( name.indexOf( "leg_front" ) == 0 ) setJoint( pose, name, [ 0, -s * 12, 0 ] );        // front legs reach forward
        }
        setJoint( pose, "thorax", [ 14, 6 * Math.sin( ph ), 0 ], [ 0, -0.06 + 0.03 * Math.abs( bounce ), 0 ] );
        setJoint( pose, "abdomen", [ 10 + 15 * bounce, 5 * Math.sin( ph ), 0 ] );
        setJoint( pose, "abdomen_tip", [ 12 * Math.sin( 2 * ph - 0.9 ), 0, 0 ] );
        setJoint( pose, "head", [ -10, 20, 5 * Math.sin( 2 * ph ) ] );               // looking back over the shoulder
        setJoint( pose, "antenna_L", [ 10 * bounce, 0, 0 ] );
        setJoint( pose, "antenna_R", [ 10 * Math.sin( 2 * ph + 0.5 ), 0, 0 ] );
        result.push( pose );
    }
    return result;
}


//
//  Save / load (JSON file with the frame time and every keyframe pose)
//
function saveAnimation( frameTime ) {
    var data = JSON.stringify( { version: 1, frameTime: frameTime, frames: frames }, null, 1 );
    var a = document.createElement( "a" );
    a.href = URL.createObjectURL( new Blob( [ data ], { type: "application/json" } ) );
    a.download = "moth-animation.json";
    a.click();
    URL.revokeObjectURL( a.href );
}

// Returns the frame time stored in the file (or null).
function loadAnimation( text ) {
    var data = JSON.parse( text );
    if ( !data.frames || !data.frames.length ) throw "no keyframes in file";
    frames = data.frames;
    currentFrame = 0;
    playing = false;
    animTime = 0;
    setPose( frames[0] );
    return data.frameTime || null;
}
