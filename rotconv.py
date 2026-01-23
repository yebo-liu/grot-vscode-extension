#!/usr/bin/env python3.8
# encoding: utf-8
from __future__ import print_function, division
__doc__ = """
rotconv.py

Parses and reformats plate model rotation files. Needs one input file. Output will be
located in the same directory as input file and named <input>_formatted.rot

Default modus operandi is to convert existing *.rot files to the new *.grot format.
"""

__author__ = "Christian Heine; mailto:chhei@paleoearthlabs.org"
__license__ = """
    rotconv.py -- gptools Python scripts for GPlates
    Copyright (C) 2020 Christian Heine, PaleoEarthLabs.org
    
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
"""
__version__="2.0"
__copyright__ = "Copyright (c) Christian Heine, 2009-2021."


# =========================================================================== #
# --- Import modules
# =========================================================================== #

from gptools import *
import argparse
from decimal import *
import sys
import os
import os.path
# from string import Template

# =========================================================================== #
# --- Set up command line options
# =========================================================================== #

__usage__ = "usage: %prog [options] inputfile"

# parser.add_argument("-f", "--file", dest="filename",
                  # help="write report to FILE", metavar="FILE")

parser = argparse.ArgumentParser(  )
# parser = argparse.ArgumentParser( usage=__usage__, version=__version__ )

parser.add_argument( "-v", "-V", "--verbose", action="store_true", dest="VERBOSE", default=False,
                    help="make lots of noise [false]" )

parser.add_argument( 'infile', type=argparse.FileType('r') )

#--- Output format options
parser.add_argument( "-o", "--outformat",
                    metavar="outputFormat", dest="outformat", default="GROT",
                    help="""Choose from the following output format options: 
- GROT [default], 
- ROT [PLATES rotation file format]""" )

parser.add_argument( "-m", "--platemodel",
                    help="Provide the plate model name, in case this is not specified in the file" )

parser.add_argument( "-s", "--startage",
                    metavar="startage", dest="ageFilterOld", default=4000,
                    help="""Oldest age for moving plate rotation sequence. This parameter can be
used for age-based filtering of rotation files. Setting this to 200 for example would
result in all MPRS sequences being truncated at ages younger than 200 Million years.
""" )

parser.add_argument( "-r", "--refkey",
                    metavar="refKey", dest="referenceKey", default="PlateModelNotSpecified",
                    help="""Provide a regular expression which characterises your reference key systematics.
This will help to dramatically increase the hit rate in case you've used some
systematic encoding of citation keys.
""" )

# parser.add_argument("-u", "--user_model",
#                     action="store_const", dest="dataModel", const=4,
#                     help="Supply a list of : "
#                     "# REFNO, LPlateID, RPlateID, PlateID, Type, FromAge, Toage, Code, Name")
# #TODO: Think about how this needs to be done. Ideally this needs to be a dictionary. Maybe interactive specification?

# parser.add_argument("-r", "--rotation_file",
#                     metavar="ROTFILE", help="Basename of the GPlates exported rotation parameters for time slices")

# parser.add_argument("-t", "--time",
#                     metavar="reconTime", help="Time of reconstruction"),
args  = parser.parse_args()

#--- Set global VERBOSE and OUTFILEFORMAT
global OUTFILEFORMAT 
global VERBOSE 
global PLATEMODEL # make sure that this is available in the modules as well.

VERBOSE = args.VERBOSE
OUTFILEFORMAT = args.outformat
# PLATEMODEL = args.plateModel

def main():
    """docstring for main"""
    
    #--- Set precision
    getcontext().prec = 6
    
    # print( sys.argv[1:] ) # argv[0] is the script name
    
    if not sys.argv[ 1: ]:
        print( __doc__ )
        sys.exit( "No input file specified!\n-----------------------------" )
    
    #--- Check input
    # try:
    #    isFile = os.path.isfile( sys.argv[ 1:] )
    # except:
    #     print( __doc__ )
    #     sys.exit( "Input specified is not a file!\n-----------------------------" )
    
    infileBaseName = sys.argv[ 1 ]
    print( "--- Input file: ", infileBaseName )
    
    #--- Lists to hold errors re non-0Ma zero rotations and future rotations
    zeroRotations = []
    futureRotations = []
    replacedRotations = []
    
    #--- DICTIONARIES/LISTS TO HOLD THE ROTATION PARAMETERS 
    inputRawRotDict = {}
    inputPIDList = []
    plateAcronyms = {}
    
    #-------------------------------------------------------------------------#
    #--- ROT/GROT FILE PROCESSING
    #-------------------------------------------------------------------------#
    
    print( "\n --- Processing rot/grot file(s) --- ")
            
    input_file = open( sys.argv[ 1 ], 'r' )
    rotLines = input_file.readlines()
    input_file.close()

    #--- OUTPUT FILE NAMING
    if OUTFILEFORMAT == "GROT":
        out = infileBaseName[:-4] + "_formatted.grot"
    else:  # ROT format
        out = infileBaseName[:-4] + "_formatted.rot"
        
    outfile = open(out, 'w')
    err = infileBaseName[:-4] + "_errors.out"
    errorfile = open( err, 'w' )
    plateacronyms = infileBaseName[:-4] + "_plateacronyms.csv"

    entryID = 0        
    for line in rotLines:
        entryID += 1
        inputRawRotDict[ entryID ] = readROT( line )
    
    #--------------------------------------------------------------------------# 
    #--- ROTATION DATA PROCESSING 
    #--------------------------------------------------------------------------# 

    #--- Isolate the unique plate IDs using a set.
    print( "\n --- Generating list of unique plate ids from input rotation file" )
    for elem in inputRawRotDict:
        # print elem, int( Decimal( inputRawRotDict[ elem ][ 0 ] ) )
        inputPIDList.append( int( Decimal( inputRawRotDict[ elem ][ 0 ] ) ) )
    
    inputPIDList.sort()
    uniquePIDsInput = set( inputPIDList )
    print( )
    print( "-"*80)
    print( "--- Unique parent PIDs")
    print( uniquePIDsInput)
    print()
    
    #--- Reformat to plateid controlled blocks and sort ascending
    infilePlateIdDict, mprsDict, bibDict = generatePlateIdDict( inputRawRotDict, uniquePIDsInput, majorPlateIDsDict, VERBOSE )
    
    # print( len(infilePlateIdDict) )
    # print len(infilePlateIdDict[101])
    # print( infilePlateIdDict.keys() )
    # print( infilePlateIdDict[206] )
    # print( bibDict )
    # sys.exit(0)
    
    #--- Write GROT header to outfile
    outfile.write( outputReporting.makeHeader( infileBaseName, OUTFILEFORMAT ) )
    
    #-------------------------------------------------------------------------#
    #--- LOOP OVER plateIDList and write to a new outfile                  ---#
    #-------------------------------------------------------------------------#
    
    #--- Loop over dictionary data for sorted plate ids.
    plateIDList = list( uniquePIDsInput )
    
    #--- Sort all available PlateIDs in place
    # plateIDList.sort()
    # print(plateIDList)
    
    #--- Generate a new list of PIDs which is sorted by cardinality for the PLateIDs > 100
    #--- because the Hotspots/abs ref should always come first
    
    absRefPIDs = sorted( i for i in plateIDList if i < 100 )
    cardinalPIDList0 = [ i for i in plateIDList if i >= 100 ]
    cardinalPIDList1 = list( map(str, cardinalPIDList0) )
    
    if VERBOSE:
        print(cardinalPIDList1)
        
    cardinalPIDList1.sort()
    
    newPIDList = absRefPIDs + list( map(int, cardinalPIDList1) )
    
    if VERBOSE:
        print("=" * 80)
        print("= PlateID list in shortlex: ")
    print(newPIDList)
    
    #--- Print the moving plate rotation sequence dictionary - containing all mprs'
    #--- and comment data
    if VERBOSE:
        print("PLATEID", mprsDict) # infilePlateIdDict
    
    if VERBOSE:
        
        print( "="*79,"\n" )
        print("--> List of unique PlateIDs in this rotation file: ")
        print( plateIDList )
        print( "="*79,"\n" )
    
    #--- TMP
    # print("TEST:")
    # for stg in infilePlateIdDict[201]:
    #     print( stg[ 0 ], stg[4] )

    #--- Process individual Moving plate rotation sequences contained
    #--- in the plateID list and analyse/reformat data
    # for PlateID1 in plateIDList:
    # FIXME Turn this into a function
    for PlateID1 in newPIDList:
        
        print("========================================================")
        print( "===> PlateID1: ", PlateID1 )
        
        plateIdDict = infilePlateIdDict
        
        # pprint( plateIdDict[ PlateID1 ] )
        # pprint( mprsDict[ PlateID1 ] )
        
        # stagesSeqList = list( map( Decimal, plateIdDict[ PlateID1 ].keys() ) )
        # stagesList = plateIdDict[ PlateID1 ].keys() # these are strings!
        # sorted( stageSeqList )
        # print( len(plateIdDict[ PlateID1 ]), stageSeqList )
        
        # sys.exit(0)
        #--- Order dictionary
        # print "3", plateIdDict[ PlateID1 ].keys()
        # orderedPlateStageDict = OrderedDict( sorted( plateIdDict[ PlateID1 ].keys(), key = lambda t: t[0])  )
        # print orderedPlateStageDict
        
        # stageList = []
        #
        # for i in plateIdDict[ PlateID1 ]:
        #
        #     stageList.append( i[0] )
        
        #--- Each MPRS has a list of stage rotations.
        #--- Sort those in place and process. - This is the part which screws up the 
        #--- crossovers.
        
        stageList = plateIdDict[ PlateID1 ]

        # stageList.sort( key = lambda individualStages: individualStages[0] ) # this screws up the crossovers when enabled!
        #
        # print("==================\n stageList")
        # print( stageList )
        
        #--- Find and extract inactive rotations
        # inactiveRotations = stageList.find( key = lambda individualStages: individualStages[-1] )
        # print(inactiveRotations)
        # sys.exit(0)
        # print(mprsDict)
        # print(plateIdDict)
        
        try:
            # print("try- mplatecode", mprsDict[ PlateID1 ])
            mPlateCode = mprsDict[ PlateID1 ][ "MPRS:code" ]
        except KeyError:
            # print("except- mplatecode", plateIdDict[ PlateID1 ][ 0 ][ 5 ])
            mPlateCode = plateIdDict[ PlateID1 ][ 0 ][ 5 ][ 2 ]
        
        try:
            mPlateName = mprsDict[ PlateID1 ][ "MPRS:name" ]
        except KeyError:
            mPlateName = 'FIXME'
        
        try:
            fPlateCode = mprsDict[ PlateID1 ][ "FPID:code" ]
        except KeyError:
            fPlateCode = plateIdDict[ PlateID1 ][ 0 ][ 5 ][ 3 ]
        
        movPlateRotSequence = format_mprs_header( OUTFILEFORMAT, PlateID1, mPlateCode, mPlateName, fPlateCode )
        
        if OUTFILEFORMAT == "GROT":
            outfile.write( movPlateRotSequence )
        
        if VERBOSE:
            print( movPlateRotSequence )
        
        #--- Detect xovers and correct entry in stageList if necessary
        detect_xover( stageList, PlateID1)
        
        #--- Loop over individual, sorted stage rotations for a single plateID
        for stage in stageList : #

            # method stagerot
            # cast list items from dict into specific format - rot or grot and spit back out
            # cater for scenario w/o
            # expansion of variables ust take whatever is there and if it is there cast it
            
            if VERBOSE:
                print( "    Stage rotation age:", stage[0] )
                print( "    Stage:", stage)
                print( "    ", "-"*60)
            
            #--- Stage rotation attributes including comment dictionary
            # FIXME: This all needs to go back into a class  - example: http://zetcode.com/python/fstring/
            Age = stage[ 0 ]
            Lat = stage[ 1 ]
            Lon = stage[ 2 ]
            Angle = stage[ 3 ]
            PlateID2 = stage[ 4 ]
            stageRotationCommentDict = stage[ 5 ] # dictionary of comment metadata
            rotationSource = stage[ 6 ]
            rotationInactive = stage[ 7 ]
            
            print(" Stagerot comment dict:", stageRotationCommentDict)
            #--- Formatting
            # pid1out  = str( PlateID1 ).ljust( 8 )     # TODO: adjust for max permissible plateID Length in GPlates
            # ageout   = str( "%.5f" % Age   ).rjust( 10 )
            # latout   = str( "%.5f" % Lat   ).rjust( 9 )
            # lonout   = str( "%.5f" % Lon   ).rjust( 10 )
            # angleout = str( "%.5f" % Angle ).rjust( 10 )
            # pid2out  = str( PlateID2 ).rjust( 8 )
        
            formattedCommentData = format_grot_mprs_comment( stageRotationCommentDict )
            formattedStageRotationData = '{0:>8}{1:11.5f}{2:10.5f}{3:11.5f}{4:11.5f}{5:>8}'.format( PlateID1, Age, Lat, Lon, Angle, PlateID2 )
            
            # print( formattedCommentData )
            # print( formattedStageRotationData )

            #--- Formatting the output
            if rotationInactive:  # if true do not write line out
                if OUTFILEFORMAT == "GROT":
                    formattedStageRotation =  "#" + " ".join( [formattedStageRotationData, formattedCommentData] ) + "\n"
                else:  # ROT format - write commented line
                    print( " Skipping line" )
                    formattedStageRotation =  "999 0.0 0.0 0.0 0.0 999 # " + " ".join( [formattedStageRotationData, formattedCommentData] ) + "\n"
            else:
                if OUTFILEFORMAT == "GROT":
                    formattedStageRotation =  " ".join( [formattedStageRotationData, formattedCommentData] ) + "\n"
                else:  # ROT format - use PLATES4 syntax
                    formattedStageRotation =  " ! ".join( [formattedStageRotationData, formattedCommentData] ) + "\n"                
                
            if VERBOSE:
                print( formattedStageRotation )
                
            #--- Generate formatted line for output
            #    rotLineOut = RotOutput( PlateID1, float( Age ), Lat, Lon,\
            #           Angle, PlateID2, comment, au, timestmp, ref, rotationSource, rotationInactive, absage, xover, chronid, fitrec, gts)
            #
            #    print(rotLineOut)
            #    ReformattedLine = RotOutput.format( OUTFILEFORMAT, rotLineOut) # str( )
            #
            # #--- If there is no doi we write out everything to the line
            # else:
            #    rotLineOut = RotOutput( PlateID1, float( Age ), Lat, Lon,\
            #           Angle, PlateID2, comment, au, timestmp, ref, doi, rotationSource, rotationInactive, absage, xover, chronid, fitrec, gts) #
            #    print(rotLineOut)
            #
            #    ReformattedLine = RotOutput.format( OUTFILEFORMAT, rotLineOut) # str( )

            #---
            #--- Testing for zero-rotations at time > 0 Ma
            #--- 
            
            if float( Age ) > 0.0 and Lat == 0.0 and Lat == 0.0 and Angle == 0.0:
                
                if VERBOSE:
                    print("Stage sequence %s | Zero rotation at %s Ma" % (stage, Age) )
                
                zeroRotations.append( "Zero rotation at %.2f Ma | " % float(Age) + formattedStageRotation )
            
                if VERBOSE:
                    print( formattedStageRotation )
            
            #---
            #--- Skip those future prediction rotation poles and finally write full 
            #--- stage pole + comments to file
            #---
            
            if not float( Age ) < 0.0 :
                
                outfile.write( formattedStageRotation )
            
            else:
                
                futureRotations.append( "Future rotation skipped | " + formattedStageRotation )
            
    #--- ADD BIBLIOGRAPHY SECTION
    if OUTFILEFORMAT == "GROT":
        outfile.write(  create_grot_bibinfo_section( bibDict ) )

    outfile.close()
    
    # outfile.write("#" + "-"*79 + "\n")
    # outfile.write("@BIBINFO:references \n")
    # # outfile.write("#" + "-"*79 + "\n")
    # # outfile.write('# {:<35}| {:<35}\n'.format('@REF', '@DOI'))
    #
    # for ref in bibDict.keys():
    #     outfile.write("@REF {:<35} @DOI {:<35}\n".format( ref, bibDict[ ref ]) )
    #     # '# {:-<35}| {:-<40}'.format('centered', 'test')
    #     # @REF Skogseid_1993
    
    errorfile.write( "Rotation file errors during processing - produced by rotconv.py\n" )
    errorfile.write( "\n" + "=" *80 + "\n" )
    for rR in replacedRotations:
        errorfile.write( rR )
    errorfile.write( "\n" + "=" *80 + "\n" )
    for zR in zeroRotations:
        errorfile.write( zR )
    errorfile.write( "\n" + "=" * 80 + "\n" )
    for fR in futureRotations:
        errorfile.write( fR )
    errorfile.write( "\n" + "=" * 80 + "\n" )
    errorfile.close()
    
    # print(bibDict)
    
    #--- Generate file with plate ID acronyms.
    print("=============")
    print('Acronymfile', plateacronyms )
    plateAcroFile = open( plateacronyms, 'w' )
    # writePlateAcronymFile( mprsDict, acronymfile )
    plateAcroFile.write("# Dictionary of PlateIDs, acronyms and names\n")
    plateAcroFile.write("# Generated by rotconv.py - %s\n" % str( datetime.now().isoformat() ) )
    plateAcroFile.write("PlateID,Acronym,Name\n")
    # plateAcroFile.write("#---------+---------+---------------------------------------------------\n")
    for plate in cardinalPIDList1:
        intpid = int( plate )
        # plateAcroFile.write('{0},{1},{2}\n'.format( plate, mprsDict[ plate ]['MPRS:code'], mprsDict[ plate ]['MPRS:name'] ) )
        plateAcroFile.write("{:<10} {:<8} {:<50}\n".format( plate, mprsDict[ intpid ]['MPRS:code'], mprsDict[ intpid ]['MPRS:name'] ) )
    plateAcroFile.close()
    
    print()
    print( "Your rotation file contains %s individual plates" % len( plateIDList ))
    # print "\nReformatted all %s lines of your rotation file.\n" % len(data)
    print( "Results written to", out, "\n\n")

if __name__ == "__main__":
    main()


# --- write out rot file with similar metadata.

# read file info, cast 
# 

#--- Check polygon files.

# rot file 
# read polygon file, match on plateid. PID, Name_rot, Name_Poly, GPlatesID, FROMage, TOAGE, DESCR, ACRON, Stages,
#

# EOF