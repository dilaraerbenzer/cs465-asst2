//
//  objLoader.js
//
//  Wavefront OBJ parser (our own code: the Angel & Shreiner samples have no
//  OBJ loader). It returns data in the same form the book's examples build
//  by hand, so it can go straight into flatten() and gl.bufferData():
//      pointsArray    : vec4 positions   (like pointsArray in figure.js)
//      normalsArray   : vec4 normals     (like normalsArray in shadedSphere)
//      texCoordsArray : vec2 tex coords  (like texCoordsArray in textureCube)
//
//  Every "o <name>" block becomes one part of the hierarchical model.
//  Faces with 4+ corners are split into a triangle fan. Supports negative
//  indices and the forms v, v/vt, v//vn, v/vt/vn.
//

"use strict";

function loadOBJ( text )
{
    var V = [], VT = [], VN = [];
    var parts = {};              // name -> { pointsArray, normalsArray, texCoordsArray }
    var current = null;
    var sawObject = false;

    function begin( name ) {
        if ( !parts[name] ) parts[name] = { pointsArray: [], normalsArray: [], texCoordsArray: [] };
        current = parts[name];
    }

    function index( s, n ) {
        var i = parseInt( s, 10 );
        return i < 0 ? n + i : i - 1;
    }

    var lines = text.split( "\n" );
    for ( var l = 0; l < lines.length; ++l ) {
        var line = lines[l].trim();
        if ( line.length == 0 || line[0] == "#" ) continue;
        var tok = line.split( /\s+/ );

        switch ( tok[0] ) {
        case "v":
            V.push( vec4( +tok[1], +tok[2], +tok[3], 1.0 ) );
            break;
        case "vt":
            VT.push( vec2( +tok[1], +(tok[2] || 0) ) );
            break;
        case "vn":
            VN.push( vec4( +tok[1], +tok[2], +tok[3], 0.0 ) );
            break;
        case "o":
        case "g":
            // Parts are "o" blocks; "g" is only used by files without any "o".
            if ( tok[0] == "o" ) sawObject = true;
            if ( tok[0] == "o" || !sawObject ) begin( tok.slice(1).join("_") || "default" );
            break;
        case "f":
            if ( !current ) begin( "default" );
            var corners = [];
            for ( var k = 1; k < tok.length; ++k ) {
                var s = tok[k].split( "/" );
                corners.push( {
                    v: index( s[0], V.length ),
                    t: s[1] ? index( s[1], VT.length ) : -1,
                    n: s[2] ? index( s[2], VN.length ) : -1
                } );
            }
            for ( var k = 1; k + 1 < corners.length; ++k ) {
                var tri = [ corners[0], corners[k], corners[k+1] ];
                // Flat normal for faces that have none.
                var faceNormal = null;
                if ( tri[0].n < 0 ) {
                    var t1 = subtract( V[tri[1].v], V[tri[0].v] );
                    var t2 = subtract( V[tri[2].v], V[tri[0].v] );
                    faceNormal = vec4( normalize( cross( vec3(t1[0], t1[1], t1[2]),
                                                         vec3(t2[0], t2[1], t2[2]) ) ), 0.0 );
                }
                for ( var c = 0; c < 3; ++c ) {
                    current.pointsArray.push( V[tri[c].v] );
                    current.normalsArray.push( tri[c].n >= 0 ? VN[tri[c].n] : faceNormal );
                    current.texCoordsArray.push( tri[c].t >= 0 ? VT[tri[c].t] : vec2( 0.0, 0.0 ) );
                }
            }
            break;
        default:
            break;   // mtllib, usemtl, s, l ... are not needed
        }
    }
    return parts;
}
